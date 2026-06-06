const STORAGE_KEY = "schedule-for-the-day:fallback:v3";
const MINUTES_IN_DAY = 1440;
const SNAP = 5;
const DEFAULT_DAY_RANGE = { start: 420, end: 1440 };

const els = {
  dateButton: document.querySelector("#dateButton"),
  dateInput: document.querySelector("#dateInput"),
  dateLabel: document.querySelector("#dateLabel"),
  viewModeBtn: document.querySelector("#viewModeBtn"),
  editModeBtn: document.querySelector("#editModeBtn"),
  viewScreen: document.querySelector("#viewScreen"),
  editScreen: document.querySelector("#editScreen"),
  focusState: document.querySelector("#focusState"),
  currentTitle: document.querySelector("#currentTitle"),
  currentTime: document.querySelector("#currentTime"),
  remainingLabel: document.querySelector("#remainingLabel"),
  progressBar: document.querySelector("#progressBar"),
  miniNowTime: document.querySelector("#miniNowTime"),
  dayList: document.querySelector("#dayList"),
  addBlockBtn: document.querySelector("#addBlockBtn"),
  addNoteBtn: document.querySelector("#addNoteBtn"),
  rangeStartInput: document.querySelector("#rangeStartInput"),
  rangeEndInput: document.querySelector("#rangeEndInput"),
  timeline: document.querySelector("#timeline"),
  tickLayer: document.querySelector("#tickLayer"),
  currentMarker: document.querySelector("#currentMarker"),
  currentMarkerLabel: document.querySelector("#currentMarkerLabel"),
  eventRows: document.querySelector("#eventRows"),
  editorPanel: document.querySelector("#editorPanel"),
  titleInput: document.querySelector("#titleInput"),
  labelEditor: document.querySelector("#labelEditor"),
  labelInput: document.querySelector("#labelInput"),
  timeEditor: document.querySelector("#timeEditor"),
  startInput: document.querySelector("#startInput"),
  endInput: document.querySelector("#endInput"),
  deleteBtn: document.querySelector("#deleteBtn"),
  contextMenu: document.querySelector("#contextMenu"),
  contextDeleteBtn: document.querySelector("#contextDeleteBtn"),
  deleteConfirm: document.querySelector("#deleteConfirm"),
  deleteConfirmText: document.querySelector("#deleteConfirmText"),
  confirmCancelBtn: document.querySelector("#confirmCancelBtn"),
  confirmYesBtn: document.querySelector("#confirmYesBtn"),
};

let state = normalizeState(defaultState());
let selectedId = state.items[0]?.id ?? null;
let dragState = null;
let pendingDeleteId = null;
let saveTimer = null;
let loadToken = 0;

function defaultState() {
  const today = toDateInputValue(new Date());
  return {
    date: today,
    mode: "view",
    dayRange: { ...DEFAULT_DAY_RANGE },
    items: [
      item("お礼メール", 570, 720),
      note("昼飯"),
      item("PicoCTF表彰式", 780, 840),
      item("力学", 850, 880),
      item("英語一列", 880, 900),
      item("英語上級", 900, 930),
      item("ALESS", 930, 990),
      item("ディープテック", 990, 1020),
      item("トランペット", 1050, 1140),
      note("夜飯"),
      item("お礼メール", 1200, 1260),
      note("かなたといくところ決める", "残り"),
    ],
  };
}

function emptyDay(date = toDateInputValue(new Date())) {
  return {
    date,
    mode: state?.mode ?? "view",
    dayRange: { ...DEFAULT_DAY_RANGE },
    items: [],
  };
}

function item(title, start, end) {
  return { id: crypto.randomUUID(), kind: "event", title, start, end };
}

function note(title, label = "") {
  return { id: crypto.randomUUID(), kind: "note", title, label };
}

function loadFallbackState(date) {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.date === date) return saved;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return null;
}

function normalizeState(nextState) {
  const dayRange = sanitizeRange(nextState.dayRange ?? DEFAULT_DAY_RANGE);
  return { ...nextState, dayRange };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    persistState().catch((error) => {
      console.warn("Could not save to backend database.", error);
    });
  }, 120);
}

async function persistState() {
  const payload = {
    date: state.date,
    dayRange: dayRange(),
    items: state.items,
  };
  const response = await fetch("/api/day", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Save failed: ${response.status}`);
}

async function loadDay(date, seedIfEmpty = false) {
  const token = ++loadToken;
  let nextState;

  try {
    const response = await fetch(`/api/day?date=${encodeURIComponent(date)}`);
    if (!response.ok) throw new Error(`Load failed: ${response.status}`);
    const data = await response.json();
    nextState = normalizeState({
      date,
      mode: state.mode,
      dayRange: data.dayRange,
      items: data.items ?? [],
    });
  } catch (error) {
    console.warn("Could not load backend database, using local fallback.", error);
    nextState = normalizeState(loadFallbackState(date) ?? emptyDay(date));
  }

  if (token !== loadToken) return;

  if (seedIfEmpty && nextState.items.length === 0 && date === toDateInputValue(new Date())) {
    nextState = normalizeState({ ...defaultState(), mode: state.mode });
  }

  state = nextState;
  selectedId = state.items[0]?.id ?? null;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();

  if (seedIfEmpty && state.items.length > 0) {
    saveState();
  }
}

function render() {
  els.dateInput.value = state.date;
  els.dateLabel.textContent = formatDateLabel(state.date);
  els.rangeStartInput.value = formatMinutes(dayRange().start, true);
  els.rangeEndInput.value = formatMinutes(dayRange().end, true);
  els.viewModeBtn.classList.toggle("active", state.mode === "view");
  els.editModeBtn.classList.toggle("active", state.mode === "edit");
  els.viewScreen.hidden = state.mode !== "view";
  els.editScreen.hidden = state.mode !== "edit";
  hideFloatingUi();
  renderNowMarkers();
  renderView();
  renderTimeline();
  renderEditor();
}

function renderView() {
  const today = isSelectedDateToday();
  const now = today ? currentMinutes() : 0;
  const events = sortedEvents();
  const active = today ? events.find((entry) => now >= entry.start && now < entry.end) : null;
  const next = events.find((entry) => entry.start > now);
  const lastEvent = events.at(-1);
  const display = active ?? next ?? lastEvent;

  if (!display) {
    els.focusState.textContent = "No schedule";
    els.currentTitle.textContent = "予定なし";
    els.currentTime.textContent = "";
    els.remainingLabel.textContent = "";
    els.progressBar.style.width = "0%";
  } else if (active) {
    const remaining = active.end - now;
    const elapsed = now - active.start;
    const duration = active.end - active.start;
    els.focusState.textContent = "Now";
    els.currentTitle.textContent = active.title;
    els.currentTime.textContent = `${formatMinutes(active.start)} - ${formatMinutes(active.end)}`;
    els.remainingLabel.textContent = `残り ${formatDuration(remaining)}`;
    els.progressBar.style.width = `${clamp((elapsed / duration) * 100, 0, 100)}%`;
  } else if (next) {
    els.focusState.textContent = today ? `Next ${formatMinutes(next.start)}` : "First";
    els.currentTitle.textContent = next.title;
    els.currentTime.textContent = `${formatMinutes(next.start)} - ${formatMinutes(next.end)}`;
    els.remainingLabel.textContent = today ? `開始まで ${formatDuration(next.start - now)}` : "";
    els.progressBar.style.width = "0%";
  } else {
    els.focusState.textContent = today ? "Done" : "Last";
    els.currentTitle.textContent = lastEvent.title;
    els.currentTime.textContent = `${formatMinutes(lastEvent.start)} - ${formatMinutes(lastEvent.end)}`;
    els.remainingLabel.textContent = today ? "今日の予定は終了" : "";
    els.progressBar.style.width = today ? "100%" : "0%";
  }

  els.dayList.innerHTML = "";
  for (const entry of sortedItems()) {
    const li = document.createElement("li");
    if (entry.kind === "event") {
      if (today && now >= entry.end) li.classList.add("past");
      if (active?.id === entry.id) li.classList.add("active");
      li.innerHTML = `<time>${formatMinutes(entry.start)}</time><span>${escapeHtml(entry.title)}</span>`;
    } else {
      li.innerHTML = `<span class="note-label">${escapeHtml(entry.label || "")}</span><span>${escapeHtml(entry.title)}</span>`;
    }
    els.dayList.append(li);
  }
}

function renderTimeline() {
  renderTicks();
  els.eventRows.innerHTML = "";

  const lane = document.createElement("div");
  lane.className = "timeline-lane";
  const layouts = layoutEvents(sortedEvents().filter(isVisibleInRange));
  lane.style.height = `${Math.min(122, Math.max(62, 22 + layouts.levels * 28))}px`;
  for (const layout of layouts.items) {
    lane.append(createEventBlock(layout.entry, layout.level));
  }
  els.eventRows.append(lane);

  const notes = state.items.filter((entry) => entry.kind === "note");
  if (notes.length) {
    const noteStrip = document.createElement("div");
    noteStrip.className = "notes-strip";
    for (const entry of notes) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.id = entry.id;
      button.className = entry.id === selectedId ? "selected" : "";
      button.textContent = `${entry.label ? `${entry.label} ` : ""}${entry.title}`;
      button.addEventListener("click", () => selectItem(entry.id));
      button.addEventListener("dblclick", () => startTitleEdit(entry.id));
      button.addEventListener("contextmenu", (event) => openContextMenu(event, entry.id));
      button.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          startTitleEdit(entry.id);
        }
      });
      noteStrip.append(button);
    }
    els.eventRows.append(noteStrip);
  }
}

function createEventBlock(entry, level = 0) {
  const range = dayRange();
  const clippedStart = clamp(entry.start, range.start, range.end);
  const clippedEnd = clamp(entry.end, range.start, range.end);
  const block = document.createElement("div");
  block.className = "schedule-block";
  block.dataset.id = entry.id;
  block.tabIndex = 0;
  block.title = `${entry.title} ${formatMinutes(entry.start)}-${formatMinutes(entry.end)}`;
  block.style.left = `${minutesToPercent(clippedStart)}%`;
  block.style.width = `${Math.max(0.4, minutesToPercent(clippedEnd) - minutesToPercent(clippedStart))}%`;
  block.style.top = `${12 + level * 28}px`;
  if (entry.end - entry.start < 90) block.classList.add("compact");
  if (entry.id === selectedId) block.classList.add("selected");
  block.innerHTML = `
    <span class="time-badge start">${formatMinutes(entry.start)}</span>
    <span class="block-title">${escapeHtml(entry.title)}</span>
    <span class="time-badge end">${formatMinutes(entry.end)}</span>
    <span class="resize-handle start" aria-hidden="true"></span>
    <span class="resize-handle end" aria-hidden="true"></span>
  `;

  block.addEventListener("pointerdown", (event) => startDrag(event, entry.id, "move"));
  block.querySelector(".resize-handle.start").addEventListener("pointerdown", (event) => startDrag(event, entry.id, "start"));
  block.querySelector(".resize-handle.end").addEventListener("pointerdown", (event) => startDrag(event, entry.id, "end"));
  block.addEventListener("click", () => selectItem(entry.id));
  block.addEventListener("dblclick", () => startTitleEdit(entry.id));
  block.addEventListener("contextmenu", (event) => openContextMenu(event, entry.id));
  block.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      startTitleEdit(entry.id);
    }
  });
  return block;
}

function layoutEvents(events) {
  const activeEnds = [];
  const items = events.map((entry) => {
    let level = activeEnds.findIndex((end) => entry.start >= end);
    if (level === -1) {
      level = activeEnds.length;
      activeEnds.push(entry.end);
    } else {
      activeEnds[level] = entry.end;
    }
    return { entry, level };
  });
  return { items, levels: Math.max(1, activeEnds.length) };
}

function renderTicks() {
  const range = dayRange();
  els.tickLayer.innerHTML = "";
  for (let minutes = range.start; minutes <= range.end; minutes += 15) {
    const tick = document.createElement("span");
    tick.className = `tick ${minutes % 60 === 0 ? "major" : "minor"}`;
    tick.style.left = `${minutesToPercent(minutes)}%`;
    els.tickLayer.append(tick);

    if (minutes % 180 === 0 || minutes === range.start || minutes === range.end) {
      const label = document.createElement("span");
      label.className = "tick-label";
      if (minutes === range.start) label.classList.add("edge-start");
      if (minutes === range.end) label.classList.add("edge-end");
      label.style.left = `${minutesToPercent(minutes)}%`;
      label.textContent = formatMinutes(minutes);
      els.tickLayer.append(label);
    }
  }
}

function renderEditor() {
  const selected = state.items.find((entry) => entry.id === selectedId) ?? sortedItems()[0];
  selectedId = selected?.id ?? null;
  els.editorPanel.hidden = !selected;
  if (!selected) return;

  els.titleInput.value = selected.title;
  els.labelEditor.hidden = selected.kind !== "note";
  els.labelInput.value = selected.kind === "note" ? selected.label || "" : "";
  els.timeEditor.hidden = selected.kind !== "event";
  if (selected.kind === "event") {
    els.startInput.value = formatMinutes(selected.start, true);
    els.endInput.value = formatMinutes(selected.end, true);
  }
}

function renderNowMarkers() {
  const today = isSelectedDateToday();
  const now = currentMinutes();
  const inRange = today && now >= dayRange().start && now <= dayRange().end;
  els.currentMarker.hidden = !inRange;
  els.currentMarker.style.left = `${minutesToPercent(now)}%`;
  els.currentMarkerLabel.textContent = formatMinutes(now);
  els.miniNowTime.parentElement.hidden = !today;
  els.miniNowTime.textContent = formatMinutes(now);
}

function startDrag(event, id, mode) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  selectedId = id;
  const entry = state.items.find((candidate) => candidate.id === id);
  if (!entry || entry.kind !== "event") return;

  const block = event.currentTarget.closest(".schedule-block");
  block?.focus({ preventScroll: true });
  markSelectedBlock(id);
  block?.classList.add("dragging");
  dragState = {
    id,
    mode,
    pointerStart: event.clientX,
    start: entry.start,
    end: entry.end,
    rulerRect: els.tickLayer.getBoundingClientRect(),
  };

  document.addEventListener("pointermove", onDrag);
  document.addEventListener("pointerup", stopDrag, { once: true });
  renderEditor();
}

function markSelectedBlock(id) {
  document.querySelectorAll(".schedule-block.selected, .notes-strip button.selected").forEach((element) => {
    element.classList.remove("selected");
  });
  document.querySelector(`.schedule-block[data-id="${CSS.escape(id)}"]`)?.classList.add("selected");
}

function onDrag(event) {
  if (!dragState) return;
  const entry = state.items.find((candidate) => candidate.id === dragState.id);
  if (!entry) return;

  const range = dayRange();
  const duration = dragState.end - dragState.start;
  const deltaMinutes = snap(((event.clientX - dragState.pointerStart) / dragState.rulerRect.width) * (range.end - range.start));

  if (dragState.mode === "move") {
    const start = clamp(snap(dragState.start + deltaMinutes), range.start, range.end - duration);
    entry.start = start;
    entry.end = start + duration;
  }

  if (dragState.mode === "start") {
    entry.start = clamp(snap(dragState.start + deltaMinutes), range.start, entry.end - SNAP);
  }

  if (dragState.mode === "end") {
    entry.end = clamp(snap(dragState.end + deltaMinutes), entry.start + SNAP, range.end);
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  updateDraggedBlock(entry);
  updateDraggedEditorTimes(entry);
}

function updateDraggedBlock(entry) {
  const block = document.querySelector(`.schedule-block[data-id="${CSS.escape(entry.id)}"]`);
  if (!block) return;

  const range = dayRange();
  const clippedStart = clamp(entry.start, range.start, range.end);
  const clippedEnd = clamp(entry.end, range.start, range.end);
  block.style.left = `${minutesToPercent(clippedStart)}%`;
  block.style.width = `${Math.max(0.4, minutesToPercent(clippedEnd) - minutesToPercent(clippedStart))}%`;
  block.classList.toggle("compact", entry.end - entry.start < 90);
  block.querySelector(".time-badge.start").textContent = formatMinutes(entry.start);
  block.querySelector(".time-badge.end").textContent = formatMinutes(entry.end);
  block.title = `${entry.title} ${formatMinutes(entry.start)}-${formatMinutes(entry.end)}`;
}

function updateDraggedEditorTimes(entry) {
  if (entry.id !== selectedId) return;
  els.startInput.value = formatMinutes(entry.start, true);
  els.endInput.value = formatMinutes(entry.end, true);
}

function stopDrag() {
  const finishedDrag = dragState;
  dragState = null;
  document.removeEventListener("pointermove", onDrag);
  if (finishedDrag) {
    document.querySelector(`.schedule-block[data-id="${CSS.escape(finishedDrag.id)}"]`)?.classList.remove("dragging");
  }
  saveState();
  renderNowMarkers();
  renderView();
  renderEditor();
}

function addBlock() {
  const range = dayRange();
  const now = isSelectedDateToday() ? snap(currentMinutes()) : range.start;
  const start = clamp(now, range.start, range.end - 60);
  const next = item("新しい予定", start, start + 60);
  state.items.push(next);
  selectedId = next.id;
  saveState();
  render();
  startTitleEdit(next.id);
}

function addNote() {
  const next = note("メモ");
  state.items.push(next);
  selectedId = next.id;
  saveState();
  render();
  startTitleEdit(next.id);
}

function updateSelectedTitle() {
  const selected = state.items.find((entry) => entry.id === selectedId);
  if (!selected) return;
  selected.title = els.titleInput.value.trim() || "無題";
  saveState();
  renderTimeline();
  renderView();
}

function updateSelectedLabel() {
  const selected = state.items.find((entry) => entry.id === selectedId);
  if (!selected || selected.kind !== "note") return;
  selected.label = els.labelInput.value.trim();
  saveState();
  renderTimeline();
  renderView();
}

function updateSelectedTimes() {
  const selected = state.items.find((entry) => entry.id === selectedId);
  if (!selected || selected.kind !== "event") return;
  let start = parseTimeText(els.startInput.value, selected.start);
  let end = parseTimeText(els.endInput.value, selected.end);
  start = snap(start);
  end = snap(end);
  if (end <= start) end = clamp(start + SNAP, SNAP, MINUTES_IN_DAY);
  selected.start = clamp(start, 0, MINUTES_IN_DAY - SNAP);
  selected.end = clamp(end, selected.start + SNAP, MINUTES_IN_DAY);
  saveState();
  render();
}

function updateDayRange() {
  const fallback = dayRange();
  const start = parseTimeText(els.rangeStartInput.value, fallback.start);
  const end = parseTimeText(els.rangeEndInput.value, fallback.end);
  state.dayRange = sanitizeRange({ start, end });
  saveState();
  render();
}

function selectItem(id) {
  selectedId = id;
  hideFloatingUi();
  render();
  focusSelectedItem(id);
}

function startTitleEdit(id = selectedId) {
  if (id) selectedId = id;
  renderEditor();
  requestAnimationFrame(() => {
    els.titleInput.focus();
    els.titleInput.select();
  });
}

function focusSelectedItem(id = selectedId) {
  requestAnimationFrame(() => {
    const target =
      document.querySelector(`.schedule-block[data-id="${CSS.escape(id)}"]`) ??
      document.querySelector(`.notes-strip button[data-id="${CSS.escape(id)}"]`);
    target?.focus({ preventScroll: true });
  });
}

function openContextMenu(event, id) {
  event.preventDefault();
  selectedId = id;
  render();
  els.contextMenu.style.left = `${Math.min(event.clientX, window.innerWidth - 130)}px`;
  els.contextMenu.style.top = `${Math.min(event.clientY, window.innerHeight - 54)}px`;
  els.contextMenu.hidden = false;
}

function showDeleteConfirm(id = selectedId) {
  const selected = state.items.find((entry) => entry.id === id);
  if (!selected) return;
  pendingDeleteId = id;
  els.contextMenu.hidden = true;
  els.deleteConfirmText.textContent = `Delete "${selected.title}"?`;
  els.deleteConfirm.hidden = false;
  els.confirmYesBtn.focus();
}

function hideFloatingUi() {
  els.contextMenu.hidden = true;
  els.deleteConfirm.hidden = true;
  pendingDeleteId = null;
}

function confirmDelete() {
  const id = pendingDeleteId ?? selectedId;
  state.items = state.items.filter((entry) => entry.id !== id);
  selectedId = sortedItems()[0]?.id ?? null;
  pendingDeleteId = null;
  saveState();
  render();
}

function dayRange() {
  return sanitizeRange(state.dayRange ?? DEFAULT_DAY_RANGE);
}

function sanitizeRange(range) {
  const start = clamp(snap(Number(range.start) || DEFAULT_DAY_RANGE.start), 0, MINUTES_IN_DAY - 60);
  const end = clamp(snap(Number(range.end) || DEFAULT_DAY_RANGE.end), start + 60, MINUTES_IN_DAY);
  return { start, end };
}

function isVisibleInRange(entry) {
  const range = dayRange();
  return entry.end > range.start && entry.start < range.end;
}

function minutesToPercent(minutes) {
  const range = dayRange();
  return ((clamp(minutes, range.start, range.end) - range.start) / (range.end - range.start)) * 100;
}

function sortedItems() {
  return [...state.items].sort((a, b) => {
    const aStart = a.kind === "event" ? a.start : MINUTES_IN_DAY + state.items.indexOf(a);
    const bStart = b.kind === "event" ? b.start : MINUTES_IN_DAY + state.items.indexOf(b);
    return aStart - bStart;
  });
}

function sortedEvents() {
  return state.items
    .filter((entry) => entry.kind === "event")
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function isSelectedDateToday() {
  return state.date === toDateInputValue(new Date());
}

function currentMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(value) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).format(date);
}

function formatMinutes(minutes, padded = false) {
  const normalized = clamp(Math.round(minutes), 0, MINUTES_IN_DAY);
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  const hourText = padded ? String(hours).padStart(2, "0") : String(hours);
  return `${hourText}:${String(mins).padStart(2, "0")}`;
}

function formatDuration(minutes) {
  const normalized = Math.max(0, Math.round(minutes));
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function parseTimeText(value, fallback) {
  const text = String(value).trim();
  const match = text.match(/^(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  if (hours === 24 && minutes === 0) return MINUTES_IN_DAY;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return fallback;
  return hours * 60 + minutes;
}

function snap(value) {
  return Math.round(value / SNAP) * SNAP;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

els.dateButton.addEventListener("click", () => {
  if (typeof els.dateInput.showPicker === "function") {
    els.dateInput.showPicker();
  } else {
    els.dateInput.focus();
    els.dateInput.click();
  }
});

els.viewModeBtn.addEventListener("click", () => {
  state.mode = "view";
  saveState();
  render();
});

els.editModeBtn.addEventListener("click", () => {
  state.mode = "edit";
  saveState();
  render();
});

els.dateInput.addEventListener("change", () => {
  const nextDate = els.dateInput.value || toDateInputValue(new Date());
  loadDay(nextDate);
});

els.addBlockBtn.addEventListener("click", addBlock);
els.addNoteBtn.addEventListener("click", addNote);
els.titleInput.addEventListener("input", updateSelectedTitle);
els.titleInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") els.titleInput.blur();
});
els.labelInput.addEventListener("input", updateSelectedLabel);
els.labelInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") els.labelInput.blur();
});
els.startInput.addEventListener("change", updateSelectedTimes);
els.endInput.addEventListener("change", updateSelectedTimes);
els.startInput.addEventListener("blur", updateSelectedTimes);
els.endInput.addEventListener("blur", updateSelectedTimes);
els.startInput.addEventListener("keydown", commitSelectedTimesOnEnter);
els.endInput.addEventListener("keydown", commitSelectedTimesOnEnter);
els.rangeStartInput.addEventListener("change", updateDayRange);
els.rangeEndInput.addEventListener("change", updateDayRange);
els.rangeStartInput.addEventListener("blur", updateDayRange);
els.rangeEndInput.addEventListener("blur", updateDayRange);
els.rangeStartInput.addEventListener("keydown", commitDayRangeOnEnter);
els.rangeEndInput.addEventListener("keydown", commitDayRangeOnEnter);
els.deleteBtn.addEventListener("click", () => showDeleteConfirm(selectedId));
els.contextDeleteBtn.addEventListener("click", () => showDeleteConfirm(selectedId));
els.confirmCancelBtn.addEventListener("click", () => hideFloatingUi());
els.confirmYesBtn.addEventListener("click", confirmDelete);

document.addEventListener("click", (event) => {
  if (!els.contextMenu.hidden && !els.contextMenu.contains(event.target)) {
    els.contextMenu.hidden = true;
  }
});

document.addEventListener("keydown", (event) => {
  const activeEl = document.activeElement;
  const activeTag = activeEl?.tagName;
  const isTyping = activeTag === "INPUT" || activeTag === "TEXTAREA";

  if (!els.deleteConfirm.hidden && event.key === "Enter") {
    event.preventDefault();
    confirmDelete();
    return;
  }

  if ((!els.deleteConfirm.hidden || !els.contextMenu.hidden) && event.key === "Escape") {
    event.preventDefault();
    hideFloatingUi();
    return;
  }

  if (state.mode !== "edit") return;

  if ((event.key === "Backspace" || event.key === "Delete") && !isTyping && selectedId) {
    event.preventDefault();
    showDeleteConfirm(selectedId);
    return;
  }

  const focusedSchedule =
    activeEl?.classList?.contains("schedule-block") ||
    activeEl?.closest?.(".notes-strip") ||
    activeTag === "BODY";

  if (event.key === "Enter" && !isTyping && selectedId && focusedSchedule) {
    event.preventDefault();
    startTitleEdit(selectedId);
  }
});

function commitDayRangeOnEnter(event) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  updateDayRange();
  event.currentTarget.blur();
}

function commitSelectedTimesOnEnter(event) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  updateSelectedTimes();
  event.currentTarget.blur();
}

render();
loadDay(state.date, true);
setInterval(render, 60 * 1000);
