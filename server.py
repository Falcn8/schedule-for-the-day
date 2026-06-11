#!/usr/bin/env python3
import json
import os
import secrets
import sqlite3
import time
import uuid
from datetime import datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlencode, urlparse
from urllib.request import Request, urlopen

try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "schedule.db"
GOOGLE_CREDENTIALS_PATH = ROOT / "google_credentials.json"
GOOGLE_TOKEN_PATH = ROOT / ".google-token.json"
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/{calendar_id}/events"
GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.readonly"
OAUTH_STATES = {}


def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with connect() as conn:
        conn.executescript(
            """
            create table if not exists day_ranges (
              date text primary key,
              start integer not null,
              end integer not null,
              updated_at text not null default current_timestamp
            );

            create table if not exists schedule_items (
              id text primary key,
              date text not null,
              kind text not null check (kind in ('event', 'note')),
              title text not null,
              label text not null default '',
              start integer,
              end integer,
              sort_index integer not null,
              updated_at text not null default current_timestamp
            );

            create index if not exists idx_schedule_items_date_sort
              on schedule_items(date, sort_index);

            create table if not exists calendar_sources (
              id text primary key,
              url text not null unique,
              name text not null default '',
              updated_at text not null default current_timestamp
            );
            """
        )


def get_day(date):
    with connect() as conn:
        has_any_data = conn.execute(
            """
            select
              exists(select 1 from day_ranges)
              or exists(select 1 from schedule_items) as has_any_data
            """
        ).fetchone()["has_any_data"]
        day_range = conn.execute(
            "select start, end from day_ranges where date = ?",
            (date,),
        ).fetchone()
        rows = conn.execute(
            """
            select id, kind, title, label, start, end
            from schedule_items
            where date = ?
            order by sort_index asc
            """,
            (date,),
        ).fetchall()

    return {
        "date": date,
        "hasData": bool(day_range or rows),
        "isFirstRun": not bool(has_any_data),
        "dayRange": {
            "start": day_range["start"] if day_range else 420,
            "end": day_range["end"] if day_range else 1440,
        },
        "items": [dict(row) for row in rows],
    }


def get_previous_populated_day(before_date):
    with connect() as conn:
        row = conn.execute(
            """
            select date
            from schedule_items
            where date < ?
            group by date
            order by date desc
            limit 1
            """,
            (before_date,),
        ).fetchone()
    return get_day(row["date"]) if row else None


def save_day(payload):
    date = payload["date"]
    day_range = payload.get("dayRange") or {}
    items = payload.get("items") or []

    with connect() as conn:
        conn.execute(
            """
            insert into day_ranges(date, start, end, updated_at)
            values (?, ?, ?, current_timestamp)
            on conflict(date) do update set
              start = excluded.start,
              end = excluded.end,
              updated_at = current_timestamp
            """,
            (date, int(day_range.get("start", 420)), int(day_range.get("end", 1440))),
        )
        conn.execute("delete from schedule_items where date = ?", (date,))
        conn.executemany(
            """
            insert into schedule_items(id, date, kind, title, label, start, end, sort_index, updated_at)
            values (?, ?, ?, ?, ?, ?, ?, ?, current_timestamp)
            """,
            [
                (
                    item["id"],
                    date,
                    item["kind"],
                    item.get("title") or "Untitled",
                    item.get("label") or "",
                    item.get("start"),
                    item.get("end"),
                    index,
                )
                for index, item in enumerate(items)
            ],
        )

    return get_day(date)


def read_json_file(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def write_json_file(path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def google_credentials():
    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET")
    if client_id and client_secret:
        return {"client_id": client_id, "client_secret": client_secret}

    data = read_json_file(GOOGLE_CREDENTIALS_PATH) or {}
    config = data.get("web") or data.get("installed") or data
    client_id = config.get("client_id")
    client_secret = config.get("client_secret")
    if not client_id or not client_secret:
        raise ValueError("Google Calendar credentials are not configured.")
    return {"client_id": client_id, "client_secret": client_secret}


def request_json(url, method="GET", payload=None, headers=None):
    body = None
    request_headers = headers or {}
    if payload is not None:
        body = urlencode(payload).encode("utf-8")
        request_headers = {
            "content-type": "application/x-www-form-urlencoded",
            **request_headers,
        }
    request = Request(url, data=body, headers=request_headers, method=method)
    try:
        with urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise ValueError(f"Google API request failed: {exc.code} {detail}") from exc
    except URLError as exc:
        raise ValueError(f"Could not reach Google API: {exc.reason}") from exc


def request_text(url):
    request = Request(
        url,
        headers={
            "accept": "text/calendar,text/plain,*/*",
            "user-agent": "schedule-for-the-day/1.0",
        },
    )
    try:
        with urlopen(request, timeout=20) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            return response.read().decode(charset, errors="replace")
    except HTTPError as exc:
        raise ValueError(f"ICS request failed: {exc.code}") from exc
    except URLError as exc:
        raise ValueError(f"Could not fetch ICS URL: {exc.reason}") from exc


def build_google_auth_url(redirect_uri):
    credentials = google_credentials()
    state = secrets.token_urlsafe(24)
    OAUTH_STATES[state] = {"created_at": time.time(), "redirect_uri": redirect_uri}
    query = urlencode(
        {
            "client_id": credentials["client_id"],
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": GOOGLE_SCOPE,
            "access_type": "offline",
            "include_granted_scopes": "true",
            "prompt": "consent",
            "state": state,
        }
    )
    return f"{GOOGLE_AUTH_URL}?{query}"


def exchange_google_code(code, redirect_uri):
    credentials = google_credentials()
    token = request_json(
        GOOGLE_TOKEN_URL,
        method="POST",
        payload={
            "code": code,
            "client_id": credentials["client_id"],
            "client_secret": credentials["client_secret"],
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        },
    )
    save_google_token(token)


def save_google_token(token):
    existing = read_json_file(GOOGLE_TOKEN_PATH) or {}
    if "refresh_token" not in token and existing.get("refresh_token"):
        token["refresh_token"] = existing["refresh_token"]
    if token.get("expires_in"):
        token["expires_at"] = int(time.time()) + int(token["expires_in"])
    write_json_file(GOOGLE_TOKEN_PATH, token)


def google_access_token():
    token = read_json_file(GOOGLE_TOKEN_PATH)
    if not token:
        raise PermissionError("Google Calendar is not connected.")
    if token.get("expires_at", 0) > int(time.time()) + 60:
        return token["access_token"]
    if not token.get("refresh_token"):
        raise PermissionError("Google Calendar needs to be reconnected.")

    credentials = google_credentials()
    refreshed = request_json(
        GOOGLE_TOKEN_URL,
        method="POST",
        payload={
            "client_id": credentials["client_id"],
            "client_secret": credentials["client_secret"],
            "refresh_token": token["refresh_token"],
            "grant_type": "refresh_token",
        },
    )
    save_google_token(refreshed)
    return refreshed["access_token"]


def timezone_for_name(name):
    if name and ZoneInfo:
        try:
            return ZoneInfo(name)
        except Exception:
            pass
    return datetime.now().astimezone().tzinfo


def day_window(date, timezone_name):
    tzinfo = timezone_for_name(timezone_name)
    start = datetime.fromisoformat(date).replace(tzinfo=tzinfo)
    end = start + timedelta(days=1)
    return start, end


def parse_google_datetime(value, timezone_name):
    if not value:
        return None
    normalized = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone_for_name(timezone_name))
    return parsed.astimezone(timezone_for_name(timezone_name))


def minutes_since_midnight(value):
    return value.hour * 60 + value.minute


def google_events_for_day(date, timezone_name, calendar_id="primary"):
    access_token = google_access_token()
    window_start, window_end = day_window(date, timezone_name)
    events = []
    page_token = None
    skipped_all_day = 0

    while True:
        query = {
            "timeMin": window_start.isoformat(),
            "timeMax": window_end.isoformat(),
            "singleEvents": "true",
            "orderBy": "startTime",
        }
        if timezone_name:
            query["timeZone"] = timezone_name
        if page_token:
            query["pageToken"] = page_token

        encoded_calendar_id = quote(calendar_id, safe="")
        url = f"{GOOGLE_EVENTS_URL.format(calendar_id=encoded_calendar_id)}?{urlencode(query)}"
        data = request_json(url, headers={"authorization": f"Bearer {access_token}"})
        for event in data.get("items", []):
            if event.get("status") == "cancelled":
                continue
            start_data = event.get("start") or {}
            end_data = event.get("end") or {}
            if start_data.get("date") or end_data.get("date"):
                skipped_all_day += 1
                continue

            start_at = parse_google_datetime(start_data.get("dateTime"), timezone_name)
            end_at = parse_google_datetime(end_data.get("dateTime"), timezone_name)
            if not start_at or not end_at:
                continue

            clamped_start = max(start_at, window_start)
            clamped_end = min(end_at, window_end)
            start_minutes = minutes_since_midnight(clamped_start)
            end_minutes = minutes_since_midnight(clamped_end)
            if clamped_end.date() > clamped_start.date():
                end_minutes = 24 * 60
            if end_minutes <= start_minutes:
                continue

            events.append(
                {
                    "kind": "event",
                    "title": event.get("summary") or "Untitled",
                    "start": start_minutes,
                    "end": end_minutes,
                    "googleEventId": event.get("id"),
                }
            )

        page_token = data.get("nextPageToken")
        if not page_token:
            break

    return {
        "date": date,
        "items": events,
        "skippedAllDay": skipped_all_day,
        "calendarId": calendar_id,
    }


def normalize_ics_url(url):
    parsed = urlparse((url or "").strip())
    if parsed.scheme == "webcal":
        parsed = parsed._replace(scheme="https")
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("Enter a valid http, https, or webcal ICS URL.")
    return parsed.geturl()


def list_ics_sources():
    with connect() as conn:
        rows = conn.execute(
            """
            select id, url, name
            from calendar_sources
            order by updated_at desc
            """
        ).fetchall()
    return [dict(row) for row in rows]


def save_ics_source(payload):
    url = normalize_ics_url(payload.get("url"))
    name = (payload.get("name") or "").strip()
    with connect() as conn:
        existing = conn.execute("select id from calendar_sources where url = ?", (url,)).fetchone()
        source_id = existing["id"] if existing else str(uuid.uuid4())
        conn.execute(
            """
            insert into calendar_sources(id, url, name, updated_at)
            values (?, ?, ?, current_timestamp)
            on conflict(url) do update set
              name = excluded.name,
              updated_at = current_timestamp
            """,
            (source_id, url, name),
        )
    return {"id": source_id, "url": url, "name": name}


def delete_ics_source(source_id):
    with connect() as conn:
        conn.execute("delete from calendar_sources where id = ?", (source_id,))


def import_events_for_day(date, timezone_name):
    items = []
    skipped_all_day = 0
    source_errors = []
    google_needs_auth = False

    try:
        google_payload = google_events_for_day(date, timezone_name)
        items.extend(google_payload["items"])
        skipped_all_day += google_payload["skippedAllDay"]
    except PermissionError:
        google_needs_auth = True
    except ValueError as exc:
        source_errors.append({"source": "Google Calendar", "error": str(exc)})

    for source in list_ics_sources():
        try:
            payload = ics_events_for_day(source, date, timezone_name)
            items.extend(payload["items"])
            skipped_all_day += payload["skippedAllDay"]
        except ValueError as exc:
            source_errors.append({"source": source.get("name") or source["url"], "error": str(exc)})

    items.sort(key=lambda entry: (entry["start"], entry["end"], entry["title"]))
    return {
        "date": date,
        "items": items,
        "skippedAllDay": skipped_all_day,
        "sources": list_ics_sources(),
        "sourceErrors": source_errors,
        "googleNeedsAuth": google_needs_auth,
    }


def ics_events_for_day(source, date, timezone_name):
    text = request_text(source["url"])
    window_start, window_end = day_window(date, timezone_name)
    events = []
    skipped_all_day = 0
    source_name = source.get("name") or source["url"]

    for event in parse_ics_events(text):
        start = event.get("DTSTART")
        end = event.get("DTEND")
        if not start:
            continue
        if start["all_day"] or (end and end["all_day"]):
            skipped_all_day += 1
            continue

        start_at = start["value"].astimezone(window_start.tzinfo)
        if end:
            end_at = end["value"].astimezone(window_start.tzinfo)
        else:
            end_at = start_at + timedelta(hours=1)
        if end_at <= start_at:
            continue

        for occurrence_start, occurrence_end in expand_ics_occurrences(
            start_at,
            end_at,
            event.get("RRULE"),
            window_start,
            window_end,
        ):
            clamped_start = max(occurrence_start, window_start)
            clamped_end = min(occurrence_end, window_end)
            if clamped_end <= clamped_start:
                continue
            end_minutes = minutes_since_midnight(clamped_end)
            if clamped_end.date() > clamped_start.date():
                end_minutes = 24 * 60
            events.append(
                {
                    "kind": "event",
                    "title": event.get("SUMMARY") or "Untitled",
                    "start": minutes_since_midnight(clamped_start),
                    "end": end_minutes,
                    "source": source_name,
                }
            )

    return {"items": events, "skippedAllDay": skipped_all_day}


def parse_ics_events(text):
    lines = unfold_ics_lines(text)
    events = []
    current = None
    for line in lines:
        if line == "BEGIN:VEVENT":
            current = {}
            continue
        if line == "END:VEVENT":
            if current is not None:
                events.append(current)
            current = None
            continue
        if current is None or ":" not in line:
            continue

        raw_name, value = line.split(":", 1)
        parts = raw_name.split(";")
        name = parts[0].upper()
        params = {}
        for param in parts[1:]:
            if "=" in param:
                key, param_value = param.split("=", 1)
                params[key.upper()] = param_value

        if name in ("DTSTART", "DTEND"):
            parsed = parse_ics_datetime(value, params)
            if parsed:
                current[name] = parsed
        elif name in ("SUMMARY", "RRULE"):
            current[name] = unescape_ics_text(value)
    return events


def unfold_ics_lines(text):
    lines = []
    for raw_line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if raw_line.startswith((" ", "\t")) and lines:
            lines[-1] += raw_line[1:]
        elif raw_line:
            lines.append(raw_line)
    return lines


def parse_ics_datetime(value, params):
    value_type = params.get("VALUE", "").upper()
    if value_type == "DATE" or (len(value) == 8 and "T" not in value):
        return {"all_day": True, "value": None}

    tzinfo = timezone_for_name(params.get("TZID"))
    if value.endswith("Z"):
        dt = datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone_for_name("UTC"))
    else:
        format_text = "%Y%m%dT%H%M%S" if len(value) >= 15 else "%Y%m%dT%H%M"
        dt = datetime.strptime(value[:15 if len(value) >= 15 else 13], format_text).replace(tzinfo=tzinfo)
    return {"all_day": False, "value": dt}


def unescape_ics_text(value):
    return (
        value.replace("\\n", " ")
        .replace("\\N", " ")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
        .strip()
    )


def expand_ics_occurrences(start_at, end_at, rrule, window_start, window_end):
    if not rrule:
        if end_at > window_start and start_at < window_end:
            return [(start_at, end_at)]
        return []

    rules = parse_rrule(rrule)
    freq = rules.get("FREQ")
    if freq not in ("DAILY", "WEEKLY"):
        if end_at > window_start and start_at < window_end:
            return [(start_at, end_at)]
        return []

    interval = max(1, int(rules.get("INTERVAL", "1")))
    count = int(rules.get("COUNT", "0") or 0)
    until = parse_rrule_until(rules.get("UNTIL"), start_at.tzinfo)
    duration = end_at - start_at
    occurrences = []
    current = start_at
    generated = 0
    max_iterations = 5000

    for _ in range(max_iterations):
        if count and generated >= count:
            break
        if until and current > until:
            break
        occurrence_end = current + duration
        if occurrence_end > window_start and current < window_end:
            occurrences.append((current, occurrence_end))
        if current >= window_end and occurrences:
            break
        if current > window_end + timedelta(days=8):
            break
        generated += 1
        current = current + (timedelta(days=interval) if freq == "DAILY" else timedelta(weeks=interval))

    return occurrences


def parse_rrule(rrule):
    rules = {}
    for part in rrule.split(";"):
        if "=" in part:
            key, value = part.split("=", 1)
            rules[key.upper()] = value
    return rules


def parse_rrule_until(value, tzinfo):
    if not value:
        return None
    try:
        if value.endswith("Z"):
            return datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone_for_name("UTC")).astimezone(tzinfo)
        if "T" in value:
            return datetime.strptime(value, "%Y%m%dT%H%M%S").replace(tzinfo=tzinfo)
        return datetime.strptime(value, "%Y%m%d").replace(tzinfo=tzinfo)
    except ValueError:
        return None


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path == "/api/day":
            date = query.get("date", [""])[0]
            if not date:
                self.send_json({"error": "date is required"}, status=400)
                return
            if query.get("source", [""])[0] == "previous-populated":
                previous = get_previous_populated_day(date)
                if not previous:
                    self.send_json({"error": "no previous populated day"}, status=404)
                    return
                self.send_json(previous)
                return
            self.send_json(get_day(date))
            return
        if parsed.path == "/api/google/auth-url":
            try:
                self.send_json({"url": build_google_auth_url(self.google_redirect_uri())})
            except ValueError as exc:
                self.send_json({"error": str(exc)}, status=400)
            return
        if parsed.path == "/api/google/callback":
            self.handle_google_callback(query)
            return
        if parsed.path == "/api/google/events":
            date = query.get("date", [""])[0]
            if not date:
                self.send_json({"error": "date is required"}, status=400)
                return
            timezone_name = query.get("timeZone", [""])[0]
            calendar_id = query.get("calendarId", ["primary"])[0] or "primary"
            try:
                self.send_json(google_events_for_day(date, timezone_name, calendar_id))
            except PermissionError as exc:
                self.send_json({"error": str(exc), "needsAuth": True}, status=401)
            except ValueError as exc:
                self.send_json({"error": str(exc)}, status=400)
            return
        if parsed.path == "/api/import/events":
            date = query.get("date", [""])[0]
            if not date:
                self.send_json({"error": "date is required"}, status=400)
                return
            timezone_name = query.get("timeZone", [""])[0]
            self.send_json(import_events_for_day(date, timezone_name))
            return
        if parsed.path == "/api/ics-sources":
            self.send_json({"sources": list_ics_sources()})
            return
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        length = int(self.headers.get("content-length", "0"))
        payload = {}
        if length:
            try:
                payload = json.loads(self.rfile.read(length) or b"{}")
            except json.JSONDecodeError as exc:
                self.send_json({"error": str(exc)}, status=400)
                return

        if parsed.path == "/api/day":
            try:
                if not payload.get("date"):
                    raise ValueError("date is required")
                self.send_json(save_day(payload))
            except (KeyError, TypeError, ValueError) as exc:
                self.send_json({"error": str(exc)}, status=400)
            return

        if parsed.path == "/api/ics-sources":
            try:
                source = save_ics_source(payload)
                self.send_json({"source": source, "sources": list_ics_sources()})
            except (TypeError, ValueError) as exc:
                self.send_json({"error": str(exc)}, status=400)
            return

        self.send_json({"error": "not found"}, status=404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path == "/api/ics-sources":
            source_id = query.get("id", [""])[0]
            if not source_id:
                self.send_json({"error": "id is required"}, status=400)
                return
            delete_ics_source(source_id)
            self.send_json({"sources": list_ics_sources()})
            return

        self.send_json({"error": "not found"}, status=404)

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_google_callback(self, query):
        state = query.get("state", [""])[0]
        code = query.get("code", [""])[0]
        error = query.get("error", [""])[0]
        state_data = OAUTH_STATES.pop(state, None)
        state_created_at = state_data.get("created_at") if state_data else None
        redirect_uri = state_data.get("redirect_uri") if state_data else self.google_redirect_uri()

        if error:
            self.send_google_callback_page("Google Calendar connection was cancelled.", success=False)
            return
        if not state_created_at or time.time() - state_created_at > 600:
            self.send_google_callback_page("Google Calendar connection expired. Try again.", success=False)
            return
        if not code:
            self.send_google_callback_page("Google Calendar did not return an authorization code.", success=False)
            return

        try:
            exchange_google_code(code, redirect_uri)
        except ValueError as exc:
            self.send_google_callback_page(str(exc), success=False)
            return

        self.send_google_callback_page("Google Calendar is connected. You can close this window.", success=True)

    def google_redirect_uri(self):
        configured_redirect_uri = os.environ.get("GOOGLE_REDIRECT_URI")
        if configured_redirect_uri:
            return configured_redirect_uri
        host = self.headers.get("host") or "127.0.0.1:4173"
        return f"http://{host}/api/google/callback"

    def send_google_callback_page(self, message, success=True):
        safe_message = (
            message.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
        )
        status_text = "Connected" if success else "Connection failed"
        body = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{status_text}</title>
    <style>
      body {{
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        background: #f7f7f4;
        color: #171717;
        font: 16px/1.45 system-ui, sans-serif;
      }}
      main {{
        width: min(420px, calc(100vw - 32px));
        border: 1px solid #c9cbd0;
        border-radius: 8px;
        background: #fbfbf8;
        padding: 24px;
        box-shadow: 0 18px 60px rgba(26, 26, 26, 0.08);
      }}
      h1 {{
        margin: 0 0 8px;
        font-size: 20px;
      }}
      p {{
        margin: 0;
        color: #4f5359;
      }}
    </style>
  </head>
  <body>
    <main>
      <h1>{status_text}</h1>
      <p>{safe_message}</p>
    </main>
    <script>
      if ({str(success).lower()} && window.opener) {{
        setTimeout(() => window.close(), 900);
      }}
    </script>
  </body>
</html>""".encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    init_db()
    server = ThreadingHTTPServer(("127.0.0.1", 4173), Handler)
    print("Serving schedule app on http://127.0.0.1:4173")
    server.serve_forever()
