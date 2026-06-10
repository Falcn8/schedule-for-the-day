const STORAGE_KEY = "schedule-for-the-day:fallback:v3";
const FIRST_RUN_STORAGE_KEY = "schedule-for-the-day:first-run-demo-seen:v1";
const MINUTES_IN_DAY = 1440;
const SNAP = 5;
const HISTORY_LIMIT = 80;
const DEFAULT_DAY_RANGE = { start: 420, end: 1440 };
const MOCK_NOW = readMockNow();

const els = {
  dateButton: document.querySelector("#dateButton"),
  dateInput: document.querySelector("#dateInput"),
  dateLabel: document.querySelector("#dateLabel"),
  shortcutHelpBtn: document.querySelector("#shortcutHelpBtn"),
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
  quickAddForm: document.querySelector("#quickAddForm"),
  quickAddInput: document.querySelector("#quickAddInput"),
  copyPreviousBtn: document.querySelector("#copyPreviousBtn"),
  copySourceDateButton: document.querySelector("#copySourceDateButton"),
  copySourceDateLabel: document.querySelector("#copySourceDateLabel"),
  copySourceDateInput: document.querySelector("#copySourceDateInput"),
  copyDateBtn: document.querySelector("#copyDateBtn"),
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
  shortcutHelp: document.querySelector("#shortcutHelp"),
  shortcutHelpCloseBtn: document.querySelector("#shortcutHelpCloseBtn"),
};

let state = normalizeState(blankState());
let selectedId = state.items[0]?.id ?? null;
let selectedIds = new Set(selectedId ? [selectedId] : []);
let dragState = null;
let selectionDragState = null;
let pendingDeleteId = null;
let saveTimer = null;
let loadToken = 0;
let undoStack = [];
let redoStack = [];
let scheduleClipboard = null;
const textEditSnapshots = new WeakMap();

function demoState(date = toDateInputValue(nowDate())) {
  return {
    date,
    mode: "view",
    dayRange: { ...DEFAULT_DAY_RANGE },
    items: [
      item("Review", 480, 540),
      item("Deep work", 570, 690),
      item("Sync", 690, 735),
      item("Writing", 780, 870),
      item("Design", 900, 960),
      item("Workout", 990, 1080),
      item("Plan", 1200, 1230),
      note("Buy notebooks", "Errand"),
      note("Weekend outline", "Memo"),
    ],
  };
}

function blankState(date = toDateInputValue(nowDate()), mode = "view") {
  return {
    date,
    mode,
    dayRange: { ...DEFAULT_DAY_RANGE },
    items: [],
  };
}

function emptyDay(date = toDateInputValue(nowDate())) {
  return blankState(date, state?.mode ?? "view");
}

function item(title, start, end) {
  return { id: crypto.randomUUID(), kind: "event", title, start, end };
}

function note(title, label = "") {
  return { id: crypto.randomUUID(), kind: "note", title, label };
}

function readFallbackState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return null;
}

function loadFallbackState(date) {
  const saved = readFallbackState();
  return saved?.date === date ? saved : null;
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
  let isFirstRun = false;

  try {
    const response = await fetch(`/api/day?date=${encodeURIComponent(date)}`);
    if (!response.ok) throw new Error(`Load failed: ${response.status}`);
    const data = await response.json();
    isFirstRun = Boolean(data.isFirstRun);
    nextState = normalizeState({
      date,
      mode: state.mode,
      dayRange: data.dayRange,
      items: data.items ?? [],
    });
  } catch (error) {
    console.warn("Could not load backend database, using local fallback.", error);
    const fallbackState = loadFallbackState(date);
    isFirstRun = !readFallbackState() && !localStorage.getItem(FIRST_RUN_STORAGE_KEY);
    nextState = normalizeState(fallbackState ?? emptyDay(date));
  }

  if (token !== loadToken) return;

  const seedDemo = shouldSeedDemoData(seedIfEmpty, date, nextState.items, isFirstRun);
  if (seedDemo) {
    nextState = normalizeState({ ...demoState(date), mode: state.mode });
    if (!isScreenshotDemoRequest(date)) {
      localStorage.setItem(FIRST_RUN_STORAGE_KEY, "1");
    }
  }

  state = nextState;
  selectOnly(state.items[0]?.id ?? null);
  clearHistory();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();

  if (seedDemo) {
    saveState();
  }
}

function shouldSeedDemoData(seedIfEmpty, date, items, isFirstRun) {
  return seedIfEmpty && items.length === 0 && (isScreenshotDemoRequest(date) || isFirstRun);
}

function isScreenshotDemoRequest(date) {
  return Boolean(MOCK_NOW) && date === toDateInputValue(nowDate());
}

function createHistorySnapshot() {
  return JSON.parse(
    JSON.stringify({
      state,
      selectedId,
      selectedIds: [...selectedIds],
    }),
  );
}

function historyKey(snapshot = createHistorySnapshot()) {
  return JSON.stringify({
    state: snapshot.state,
    selectedId: snapshot.selectedId,
    selectedIds: snapshot.selectedIds ?? [],
  });
}

function hasHistoryChange(snapshot) {
  return historyKey(snapshot) !== historyKey();
}

function pushUndoSnapshot(snapshot, clearRedo = true) {
  if (!snapshot) return;
  const previousKey = undoStack.length ? historyKey(undoStack.at(-1)) : null;
  if (previousKey !== historyKey(snapshot)) {
    undoStack.push(snapshot);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  }
  if (clearRedo) redoStack = [];
}

function commitHistorySnapshot(snapshot) {
  if (!snapshot || !hasHistoryChange(snapshot)) return;
  pushUndoSnapshot(snapshot);
}

function recordUndoSnapshot() {
  pushUndoSnapshot(createHistorySnapshot());
}

function clearHistory() {
  undoStack = [];
  redoStack = [];
}

function restoreHistorySnapshot(snapshot) {
  state = normalizeState(snapshot.state);
  selectedId = state.items.some((entry) => entry.id === snapshot.selectedId)
    ? snapshot.selectedId
    : state.items[0]?.id ?? null;
  selectedIds = new Set((snapshot.selectedIds ?? [selectedId]).filter((id) => state.items.some((entry) => entry.id === id)));
  if (selectedId && !selectedIds.has(selectedId)) selectedIds.add(selectedId);
  hideFloatingUi();
  saveState();
  render();
  if (selectedId) focusSelectedItem(selectedId);
}

function undoScheduleChange() {
  const snapshot = undoStack.pop();
  if (!snapshot) return;
  redoStack.push(createHistorySnapshot());
  restoreHistorySnapshot(snapshot);
}

function redoScheduleChange() {
  const snapshot = redoStack.pop();
  if (!snapshot) return;
  pushUndoSnapshot(createHistorySnapshot(), false);
  restoreHistorySnapshot(snapshot);
}

function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  saveState();
  render();
}

function beginTextEditSnapshot(input) {
  if (!textEditSnapshots.has(input)) {
    textEditSnapshots.set(input, createHistorySnapshot());
  }
}

function commitTextEditSnapshot(input) {
  const snapshot = textEditSnapshots.get(input);
  if (!snapshot) return;
  commitHistorySnapshot(snapshot);
  textEditSnapshots.delete(input);
}

function selectedItems() {
  const ids = selectedIds.size ? selectedIds : new Set(selectedId ? [selectedId] : []);
  return state.items.filter((entry) => ids.has(entry.id));
}

function selectOnly(id) {
  selectedId = id;
  selectedIds = new Set(id ? [id] : []);
}

function selectMany(ids) {
  selectedIds = new Set(ids.filter((id) => state.items.some((entry) => entry.id === id)));
  selectedId = [...selectedIds][0] ?? null;
}

function isItemSelected(id) {
  return selectedIds.has(id) || selectedId === id;
}

function syncSelectionAfterItemsChange() {
  selectedIds = new Set([...selectedIds].filter((id) => state.items.some((entry) => entry.id === id)));
  if (!selectedId || !state.items.some((entry) => entry.id === selectedId)) {
    selectedId = [...selectedIds][0] ?? sortedItems()[0]?.id ?? null;
  }
  if (selectedId && selectedIds.size === 0) selectedIds.add(selectedId);
}

function render() {
  els.dateInput.value = state.date;
  els.dateLabel.textContent = formatDateLabel(state.date);
  updateCopySourceDateLabel();
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
    els.currentTitle.textContent = "No plan";
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
    els.remainingLabel.textContent = `Remaining ${formatDuration(remaining)}`;
    els.progressBar.style.width = `${clamp((elapsed / duration) * 100, 0, 100)}%`;
  } else if (next) {
    els.focusState.textContent = today ? `Next ${formatMinutes(next.start)}` : "First";
    els.currentTitle.textContent = next.title;
    els.currentTime.textContent = `${formatMinutes(next.start)} - ${formatMinutes(next.end)}`;
    els.remainingLabel.textContent = today ? `Starts in ${formatDuration(next.start - now)}` : "";
    els.progressBar.style.width = "0%";
  } else {
    els.focusState.textContent = today ? "Done" : "Last";
    els.currentTitle.textContent = lastEvent.title;
    els.currentTime.textContent = `${formatMinutes(lastEvent.start)} - ${formatMinutes(lastEvent.end)}`;
    els.remainingLabel.textContent = today ? "Done for today" : "";
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
  lane.addEventListener("pointerdown", startSelectionDrag);
  els.eventRows.append(lane);

  const notes = state.items.filter((entry) => entry.kind === "note");
  if (notes.length) {
    const noteStrip = document.createElement("div");
    noteStrip.className = "notes-strip";
    for (const entry of notes) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.id = entry.id;
      button.className = isItemSelected(entry.id) ? "selected" : "";
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
  syncCurrentMarkerHeight();
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
  if (isItemSelected(entry.id)) block.classList.add("selected");
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
  const selected = selectedId ? state.items.find((entry) => entry.id === selectedId) : null;
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

function syncCurrentMarkerHeight() {
  const timeRuler = els.timeline.querySelector(".time-ruler");
  const lane = els.eventRows.querySelector(".timeline-lane");
  if (!timeRuler || !lane) return;

  const height = lane.getBoundingClientRect().bottom - timeRuler.getBoundingClientRect().top;
  els.currentMarker.style.height = `${Math.max(0, height)}px`;
}

function startDrag(event, id, mode) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  selectOnly(id);
  const entry = state.items.find((candidate) => candidate.id === id);
  if (!entry || entry.kind !== "event") return;

  const block = event.currentTarget.closest(".schedule-block");
  block?.focus({ preventScroll: true });
  markSelectedBlock(id);
  block?.classList.add("dragging");
  dragState = {
    id,
    mode,
    snapshot: createHistorySnapshot(),
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

function startSelectionDrag(event) {
  if (event.button !== 0 || event.target !== event.currentTarget) return;
  event.preventDefault();
  const lane = event.currentTarget;
  const box = document.createElement("div");
  box.className = "selection-box";
  lane.append(box);
  selectionDragState = {
    lane,
    box,
    laneRect: lane.getBoundingClientRect(),
    startX: event.clientX,
    startY: event.clientY,
    currentIds: [],
  };
  updateSelectionDrag(event);
  document.addEventListener("pointermove", updateSelectionDrag);
  document.addEventListener("pointerup", stopSelectionDrag, { once: true });
}

function updateSelectionDrag(event) {
  if (!selectionDragState) return;
  const { box, laneRect, startX, startY } = selectionDragState;
  const left = Math.min(startX, event.clientX);
  const top = Math.min(startY, event.clientY);
  const width = Math.abs(event.clientX - startX);
  const height = Math.abs(event.clientY - startY);
  box.style.left = `${left - laneRect.left}px`;
  box.style.top = `${top - laneRect.top}px`;
  box.style.width = `${width}px`;
  box.style.height = `${height}px`;

  const selectionRect = { left, top, right: left + width, bottom: top + height };
  const ids = [];
  document.querySelectorAll(".schedule-block").forEach((block) => {
    const rect = block.getBoundingClientRect();
    const selected = rectsIntersect(selectionRect, rect);
    block.classList.toggle("selecting", selected);
    if (selected) ids.push(block.dataset.id);
  });
  selectionDragState.currentIds = ids;
}

function stopSelectionDrag() {
  if (!selectionDragState) return;
  document.removeEventListener("pointermove", updateSelectionDrag);
  const ids = selectionDragState.currentIds;
  document.querySelectorAll(".schedule-block.selecting").forEach((block) => {
    block.classList.remove("selecting");
  });
  selectionDragState.box.remove();
  selectionDragState = null;
  selectMany(ids);
  render();
  if (selectedId) focusSelectedItem(selectedId);
}

function rectsIntersect(a, b) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function stopDrag() {
  const finishedDrag = dragState;
  dragState = null;
  document.removeEventListener("pointermove", onDrag);
  if (finishedDrag) {
    document.querySelector(`.schedule-block[data-id="${CSS.escape(finishedDrag.id)}"]`)?.classList.remove("dragging");
    commitHistorySnapshot(finishedDrag.snapshot);
  }
  saveState();
  renderNowMarkers();
  renderView();
  renderEditor();
}

function addBlock() {
  recordUndoSnapshot();
  const range = dayRange();
  const now = isSelectedDateToday() ? snap(currentMinutes()) : range.start;
  const start = clamp(now, range.start, range.end - 60);
  const next = item("New event", start, start + 60);
  state.items.push(next);
  selectOnly(next.id);
  saveState();
  render();
  startTitleEdit(next.id);
}

function addNote() {
  recordUndoSnapshot();
  const next = note("New note");
  state.items.push(next);
  selectOnly(next.id);
  saveState();
  render();
  startTitleEdit(next.id);
}

function addQuickEvent() {
  const parsed = parseQuickAddEvent(els.quickAddInput.value);
  if (!parsed) {
    els.quickAddInput.setAttribute("aria-invalid", "true");
    els.quickAddInput.select();
    return;
  }

  recordUndoSnapshot();
  const next = item(parsed.title, parsed.start, parsed.end);
  state.items.push(next);
  selectOnly(next.id);
  els.quickAddInput.value = "";
  els.quickAddInput.removeAttribute("aria-invalid");
  saveState();
  render();
  focusSelectedItem(next.id);
}

async function copyPreviousPopulatedDay() {
  await copyFromDayUrl(`/api/day?date=${encodeURIComponent(state.date)}&source=previous-populated`, els.copyPreviousBtn);
}

async function copySpecificDay() {
  const sourceDate = els.copySourceDateInput.value;
  if (!sourceDate || sourceDate === state.date) {
    markCopyError(els.copySourceDateButton);
    return;
  }
  await copyFromDayUrl(`/api/day?date=${encodeURIComponent(sourceDate)}`, els.copyDateBtn);
}

async function copyFromDayUrl(url, control) {
  clearCopyErrors();
  control.disabled = true;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Copy source failed: ${response.status}`);
    const sourceDay = await response.json();
    copyDayIntoSelectedDate(sourceDay);
  } catch (error) {
    console.warn("Could not copy schedule.", error);
    markCopyError(control);
  } finally {
    control.disabled = false;
  }
}

function copyDayIntoSelectedDate(sourceDay) {
  const snapshot = createHistorySnapshot();
  state = normalizeState({
    date: state.date,
    mode: state.mode,
    dayRange: sourceDay.dayRange ?? DEFAULT_DAY_RANGE,
    items: cloneScheduleItems(sourceDay.items ?? []),
  });
  commitHistorySnapshot(snapshot);
  selectOnly(state.items[0]?.id ?? null);
  saveState();
  render();
  if (selectedId) focusSelectedItem(selectedId);
}

function cloneScheduleItems(items) {
  return items.map((entry) => ({
    ...entry,
    id: crypto.randomUUID(),
  }));
}

function cloneScheduleItem(entry) {
  return {
    ...entry,
    id: crypto.randomUUID(),
  };
}

function copySelectedScheduleItem() {
  const items = selectedItems();
  if (!items.length) return false;
  scheduleClipboard = JSON.parse(JSON.stringify(items));
  return true;
}

function pasteScheduleItem() {
  if (!scheduleClipboard?.length) return false;
  const nextItems = scheduleClipboard.map((entry) => {
    const next = cloneScheduleItem(entry);
    if (next.kind === "event") {
      const pastedTimes = pastedEventTimes(next);
      next.start = pastedTimes.start;
      next.end = pastedTimes.end;
    }
    return next;
  });

  recordUndoSnapshot();
  state.items.push(...nextItems);
  selectMany(nextItems.map((entry) => entry.id));
  saveState();
  render();
  focusSelectedItem(selectedId);
  return true;
}

function cutSelectedScheduleItems() {
  if (!copySelectedScheduleItem()) return false;
  deleteSelectedItems();
  return true;
}

function pastedEventTimes(entry) {
  const range = dayRange();
  const duration = entry.end - entry.start;
  if (entry.end + SNAP <= range.end) {
    return { start: entry.start + SNAP, end: entry.end + SNAP };
  }
  if (entry.start - SNAP >= range.start) {
    return { start: entry.start - SNAP, end: entry.end - SNAP };
  }
  const start = clamp(entry.start, range.start, Math.max(range.start, range.end - duration));
  return { start, end: start + duration };
}

function clearCopyErrors() {
  els.copyPreviousBtn.removeAttribute("aria-invalid");
  els.copySourceDateButton.removeAttribute("aria-invalid");
  els.copySourceDateInput.removeAttribute("aria-invalid");
  els.copyDateBtn.removeAttribute("aria-invalid");
}

function markCopyError(control) {
  control.setAttribute("aria-invalid", "true");
  control.focus();
}

function updateCopySourceDateLabel() {
  els.copySourceDateLabel.textContent = els.copySourceDateInput.value
    ? formatShortDateLabel(els.copySourceDateInput.value)
    : "Source";
}

function updateSelectedTitle() {
  const selected = state.items.find((entry) => entry.id === selectedId);
  if (!selected) return;
  selected.title = els.titleInput.value.trim() || "Untitled";
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
  const snapshot = createHistorySnapshot();
  let start = parseTimeText(els.startInput.value, selected.start);
  let end = parseTimeText(els.endInput.value, selected.end);
  start = snap(start);
  end = snap(end);
  if (end <= start) end = clamp(start + SNAP, SNAP, MINUTES_IN_DAY);
  selected.start = clamp(start, 0, MINUTES_IN_DAY - SNAP);
  selected.end = clamp(end, selected.start + SNAP, MINUTES_IN_DAY);
  commitHistorySnapshot(snapshot);
  saveState();
  render();
}

function updateDayRange() {
  const snapshot = createHistorySnapshot();
  const fallback = dayRange();
  const start = parseTimeText(els.rangeStartInput.value, fallback.start);
  const end = parseTimeText(els.rangeEndInput.value, fallback.end);
  state.dayRange = sanitizeRange({ start, end });
  commitHistorySnapshot(snapshot);
  saveState();
  render();
}

function moveSelectedEvent(deltaMinutes) {
  const selected = state.items.find((entry) => entry.id === selectedId);
  if (!selected || selected.kind !== "event") return false;
  const range = dayRange();
  const duration = selected.end - selected.start;
  const nextStart = clamp(selected.start + deltaMinutes, range.start, range.end - duration);
  if (nextStart === selected.start) return false;
  recordUndoSnapshot();
  selected.start = nextStart;
  selected.end = nextStart + duration;
  saveState();
  render();
  focusSelectedItem(selected.id);
  return true;
}

function resizeSelectedEvent(deltaMinutes) {
  const selected = state.items.find((entry) => entry.id === selectedId);
  if (!selected || selected.kind !== "event") return false;
  const range = dayRange();
  const nextEnd = clamp(selected.end + deltaMinutes, selected.start + SNAP, range.end);
  if (nextEnd === selected.end) return false;
  recordUndoSnapshot();
  selected.end = nextEnd;
  saveState();
  render();
  focusSelectedItem(selected.id);
  return true;
}

function focusQuickAdd() {
  if (state.mode !== "edit") {
    setMode("edit");
  }
  requestAnimationFrame(() => {
    els.quickAddInput.focus();
  });
}

function loadRelativeDay(offset) {
  const date = new Date(`${state.date}T00:00:00`);
  date.setDate(date.getDate() + offset);
  loadDay(toDateInputValue(date));
}

function selectItem(id) {
  selectOnly(id);
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
  if (!isItemSelected(id)) selectOnly(id);
  render();
  els.contextMenu.style.left = `${Math.min(event.clientX, window.innerWidth - 130)}px`;
  els.contextMenu.style.top = `${Math.min(event.clientY, window.innerHeight - 54)}px`;
  els.contextMenu.hidden = false;
}

function showDeleteConfirm(id = selectedId) {
  if (id && !isItemSelected(id)) selectOnly(id);
  const items = selectedItems();
  if (!items.length) return;
  pendingDeleteId = id;
  els.contextMenu.hidden = true;
  els.deleteConfirmText.textContent =
    items.length === 1 ? `Delete "${items[0].title}"?` : `Delete ${items.length} selected blocks?`;
  els.deleteConfirm.hidden = false;
  els.confirmYesBtn.focus();
}

function hideFloatingUi() {
  els.contextMenu.hidden = true;
  els.deleteConfirm.hidden = true;
  pendingDeleteId = null;
}

function showShortcutHelp() {
  els.shortcutHelp.hidden = false;
  els.shortcutHelpCloseBtn.focus();
}

function hideShortcutHelp() {
  els.shortcutHelp.hidden = true;
  els.shortcutHelpBtn.focus({ preventScroll: true });
}

function confirmDelete() {
  deleteSelectedItems(pendingDeleteId ?? selectedId);
  pendingDeleteId = null;
}

function deleteSelectedItems(fallbackId = selectedId) {
  const ids = selectedIds.size ? selectedIds : new Set(fallbackId ? [fallbackId] : []);
  const deleteIds = new Set([...ids].filter((id) => state.items.some((entry) => entry.id === id)));
  if (!deleteIds.size) return false;
  recordUndoSnapshot();
  state.items = state.items.filter((entry) => !deleteIds.has(entry.id));
  selectOnly(sortedItems()[0]?.id ?? null);
  pendingDeleteId = null;
  saveState();
  render();
  return true;
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
  return state.date === toDateInputValue(nowDate());
}

function currentMinutes() {
  const now = nowDate();
  return now.getHours() * 60 + now.getMinutes();
}

function nowDate() {
  return MOCK_NOW ? new Date(MOCK_NOW) : new Date();
}

function readMockNow() {
  const value = new URLSearchParams(window.location.search).get("mockNow");
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(value) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).format(date);
}

function formatShortDateLabel(value) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
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

function parseQuickAddEvent(value) {
  const match = String(value)
    .trim()
    .match(/^(\d{1,2}(?::?\d{2})?)\s*[-–—]\s*(\d{1,2}(?::?\d{2})?)\s+(.+)$/);
  if (!match) return null;

  const start = snap(parseTimeText(match[1], Number.NaN));
  const end = snap(parseTimeText(match[2], Number.NaN));
  const title = match[3].trim();
  if (!title || Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  return {
    start: clamp(start, 0, MINUTES_IN_DAY - SNAP),
    end: clamp(end, start + SNAP, MINUTES_IN_DAY),
    title,
  };
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

function isUndoShortcut(event) {
  return (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z";
}

function isRedoShortcut(event) {
  return (event.ctrlKey || event.metaKey) && (
    event.key.toLowerCase() === "y" ||
    (event.shiftKey && event.key.toLowerCase() === "z")
  );
}

function isCopyShortcut(event) {
  return (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "c";
}

function isPasteShortcut(event) {
  return (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "v";
}

function isCutShortcut(event) {
  return (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "x";
}

els.dateButton.addEventListener("click", () => {
  if (typeof els.dateInput.showPicker === "function") {
    els.dateInput.showPicker();
  } else {
    els.dateInput.focus();
    els.dateInput.click();
  }
});

els.viewModeBtn.addEventListener("click", () => setMode("view"));

els.editModeBtn.addEventListener("click", () => setMode("edit"));

els.dateInput.addEventListener("change", () => {
  const nextDate = els.dateInput.value || toDateInputValue(nowDate());
  loadDay(nextDate);
});

els.copySourceDateButton.addEventListener("click", () => {
  if (typeof els.copySourceDateInput.showPicker === "function") {
    els.copySourceDateInput.showPicker();
  } else {
    els.copySourceDateInput.focus();
    els.copySourceDateInput.click();
  }
});
els.addBlockBtn.addEventListener("click", addBlock);
els.addNoteBtn.addEventListener("click", addNote);
bindQuickAddInput();
bindTextInput(els.titleInput, updateSelectedTitle);
bindTextInput(els.labelInput, updateSelectedLabel);
els.copyPreviousBtn.addEventListener("click", copyPreviousPopulatedDay);
els.copyDateBtn.addEventListener("click", copySpecificDay);
els.copySourceDateInput.addEventListener("input", () => {
  clearCopyErrors();
  updateCopySourceDateLabel();
});
els.copySourceDateInput.addEventListener("change", () => {
  clearCopyErrors();
  updateCopySourceDateLabel();
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
els.shortcutHelpBtn.addEventListener("click", showShortcutHelp);
els.shortcutHelpCloseBtn.addEventListener("click", hideShortcutHelp);

document.addEventListener("click", (event) => {
  if (!els.contextMenu.hidden && !els.contextMenu.contains(event.target)) {
    els.contextMenu.hidden = true;
  }

  if (!els.shortcutHelp.hidden && event.target === els.shortcutHelp) {
    hideShortcutHelp();
  }
});

document.addEventListener("keydown", (event) => {
  const activeEl = document.activeElement;
  const activeTag = activeEl?.tagName;
  const isTyping = activeTag === "INPUT" || activeTag === "TEXTAREA";

  if (!els.shortcutHelp.hidden && event.key === "Escape") {
    event.preventDefault();
    hideShortcutHelp();
    return;
  }

  if (isTyping && event.key === "Escape") {
    event.preventDefault();
    activeEl.blur();
    return;
  }

  if (isTyping) return;

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

  if (isUndoShortcut(event)) {
    event.preventDefault();
    undoScheduleChange();
    return;
  }

  if (isRedoShortcut(event)) {
    event.preventDefault();
    redoScheduleChange();
    return;
  }

  if (state.mode === "edit" && isCopyShortcut(event)) {
    if (copySelectedScheduleItem()) event.preventDefault();
    return;
  }

  if (state.mode === "edit" && isPasteShortcut(event)) {
    if (pasteScheduleItem()) event.preventDefault();
    return;
  }

  if (state.mode === "edit" && isCutShortcut(event)) {
    if (cutSelectedScheduleItems()) event.preventDefault();
    return;
  }

  if (event.ctrlKey || event.metaKey || event.altKey) return;

  if (event.key === "?" || (event.key === "/" && event.shiftKey)) {
    event.preventDefault();
    showShortcutHelp();
    return;
  }

  if (event.key.toLowerCase() === "e") {
    event.preventDefault();
    setMode("edit");
    return;
  }

  if (event.key.toLowerCase() === "v") {
    event.preventDefault();
    setMode("view");
    return;
  }

  if (event.key === "/") {
    event.preventDefault();
    focusQuickAdd();
    return;
  }

  if (event.key === "[") {
    event.preventDefault();
    loadRelativeDay(-1);
    return;
  }

  if (event.key === "]") {
    event.preventDefault();
    loadRelativeDay(1);
    return;
  }

  if (state.mode !== "edit") return;

  if (event.key.toLowerCase() === "n") {
    event.preventDefault();
    if (event.shiftKey) {
      addNote();
    } else {
      addBlock();
    }
    return;
  }

  if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && selectedId) {
    const direction = event.key === "ArrowLeft" ? -SNAP : SNAP;
    const changed = event.shiftKey ? resizeSelectedEvent(direction) : moveSelectedEvent(direction);
    if (changed) event.preventDefault();
    return;
  }

  if ((event.key === "Backspace" || event.key === "Delete") && selectedId) {
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

function bindTextInput(input, update) {
  let composing = false;

  input.addEventListener("compositionstart", () => {
    composing = true;
  });

  input.addEventListener("compositionend", () => {
    composing = false;
    beginTextEditSnapshot(input);
    update();
  });

  input.addEventListener("input", () => {
    if (composing) return;
    beginTextEditSnapshot(input);
    update();
  });

  input.addEventListener("blur", () => {
    commitTextEditSnapshot(input);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    if (composing || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    input.blur();
  });
}

function bindQuickAddInput() {
  let composing = false;

  els.quickAddInput.addEventListener("compositionstart", () => {
    composing = true;
  });

  els.quickAddInput.addEventListener("compositionend", () => {
    composing = false;
  });

  els.quickAddInput.addEventListener("input", () => {
    els.quickAddInput.removeAttribute("aria-invalid");
  });

  els.quickAddInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    if (composing || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    addQuickEvent();
  });

  els.quickAddForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addQuickEvent();
  });
}

render();
loadDay(state.date, true);
setInterval(render, 60 * 1000);
