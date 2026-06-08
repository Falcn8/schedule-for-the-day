#!/usr/bin/env python3
import json
import sqlite3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "schedule.db"


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


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/day":
            query = parse_qs(parsed.query)
            date = query.get("date", [""])[0]
            if not date:
                self.send_json({"error": "date is required"}, status=400)
                return
            self.send_json(get_day(date))
            return
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/day":
            self.send_json({"error": "not found"}, status=404)
            return

        length = int(self.headers.get("content-length", "0"))
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
            if not payload.get("date"):
                raise ValueError("date is required")
            self.send_json(save_day(payload))
        except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
            self.send_json({"error": str(exc)}, status=400)

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    init_db()
    server = ThreadingHTTPServer(("127.0.0.1", 4173), Handler)
    print("Serving schedule app on http://127.0.0.1:4173")
    server.serve_forever()
