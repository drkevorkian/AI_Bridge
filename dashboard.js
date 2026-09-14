const SIDES = ["A", "B", "C"];
const supported = [
  { re: /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//, name: "ChatGPT" },
  { re: /^https:\/\/grok\.com\//, name: "Grok" },
  { re: /^https:\/\/claude\.ai\//, name: "Claude" },
  { re: /^https:\/\/gemini\.google\.com\//, name: "Gemini" },
  { re: /^https:\/\/copilot\.microsoft\.com\//, name: "Copilot" }
];

const $ = id => document.getElementById(id);
const THEME_KEY = "aiBridgeTheme";
const THEMES = new Set(["midnight", "slate", "light"]);
let tabsById = new Map();
let latestState = null;
let hydrated = false;
let renderedSeq = 0;
let autoScroll = true;
let selectedSourceFiles = [];
const MAX_SOURCE_FILES = 100;
const MAX_SOURCE_FILE_BYTES = 512 * 1024;
const MAX_SOURCE_FILE_CHARS = 200000;
const MAX_SOURCE_TOTAL_CHARS = 400000;
const IGNORED_SOURCE_SEGMENTS = new Set([".git", "node_modules", ".venv", "venv", "__pycache__", ".next", "dist", "build"]);

function applyTheme(theme) {
  const chosen = THEMES.has(theme) ? theme : "midnight";
  document.documentElement.dataset.theme = chosen;
  if ($("themeSelect")) $("themeSelect").value = chosen;
}

async function loadTheme() {
  const stored = await chrome.storage.local.get(THEME_KEY);
  applyTheme(stored?.[THEME_KEY]);
}

function formatHistoryTime(time) {
  if (!time) return "";
  return new Date(time).toLocaleString([], {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

function historyEmpty(text) {
  const empty = document.createElement("div");
  empty.className = "history-empty";
  empty.textContent = text;
  return empty;
}

function renderHistory(history = latestState?.history) {
  const jobs = Array.isArray(history?.jobs) ? history.jobs : [];
  const commands = Array.isArray(history?.commands) ? history.commands : [];
  const locked = Boolean(latestState?.sessionActive);

  const jobList = $("jobHistory");
  jobList.textContent = "";
  if (!jobs.length) {
    jobList.appendChild(historyEmpty("No previous jobs yet."));
  } else {
    for (const item of jobs) {
      const row = document.createElement("div");
      row.className = "history-row";

      const badge = document.createElement("div");
      badge.className = `history-badge side-${String(item.side || "a").toLowerCase()}`;
      badge.textContent = item.side || "?";

      const copy = document.createElement("div");
      copy.className = "history-copy";
      const title = document.createElement("div");
      title.className = "history-title";
      title.textContent = `${item.label || `AI ${item.side || "?"}`} · ${formatHistoryTime(item.time)}`;
      const text = document.createElement("div");
      text.className = "history-text";
      text.textContent = item.job || "";
      copy.append(title, text);

      const use = document.createElement("button");
      use.type = "button";
      use.className = "tiny ghost history-use";
      use.textContent = `Use for ${item.side || "AI"}`;
      use.disabled = locked || !SIDES.includes(item.side);
      use.addEventListener("click", () => {
        if (!locked && SIDES.includes(item.side)) $(`job${item.side}`).value = item.job || "";
      });

      row.append(badge, copy, use);
      jobList.appendChild(row);
    }
  }

  const commandList = $("commandHistory");
  commandList.textContent = "";
  if (!commands.length) {
    commandList.appendChild(historyEmpty("No previous commands yet."));
  } else {
    for (const item of commands) {
      const row = document.createElement("div");
      row.className = "history-row";

      const badge = document.createElement("div");
      badge.className = "history-badge";
      badge.textContent = "CMD";

      const copy = document.createElement("div");
      copy.className = "history-copy";
      const title = document.createElement("div");
      title.className = "history-title";
      title.textContent = formatHistoryTime(item.time);
      const text = document.createElement("div");
      text.className = "history-text";
      text.textContent = item.text || "";
      copy.append(title, text);

      const use = document.createElement("button");
      use.type = "button";
      use.className = "tiny ghost history-use";
      use.textContent = "Use";
      use.disabled = locked;
      use.addEventListener("click", () => {
        if (!locked) $("prompt").value = item.text || "";
      });

      row.append(badge, copy, use);
      commandList.appendChild(row);
    }
  }
}

function aiName(url) {
  return supported.find(x => x.re.test(url || ""))?.name || "AI";
}

function selectedTab(side) {
  return Number($(`tab${side}`).value);
}

function setSelectToTab(side, tabId) {
  if (!tabId || !tabsById.has(Number(tabId))) return false;
  $(`tab${side}`).value = String(tabId);
  return true;
}

function refreshStartLabels() {
  for (const side of SIDES) {
    const tab = tabsById.get(selectedTab(side));
    const option = [...$("startSide").options].find(o => o.value === side);
    if (option) option.textContent = `${aiName(tab?.url)} (AI ${side}) starts`;
  }
}

async function loadTabs({ preserve = true } = {}) {
  const previous = {};
  if (preserve) for (const side of SIDES) previous[side] = selectedTab(side);

  const tabs = await chrome.tabs.query({});
  const candidates = tabs.filter(t => supported.some(x => x.re.test(t.url || "")));
  tabsById = new Map(candidates.map(t => [t.id, t]));

  for (const side of SIDES) {
    const select = $(`tab${side}`);
    select.textContent = "";
    for (const tab of candidates) {
      const opt = document.createElement("option");
      opt.value = String(tab.id);
      opt.textContent = `${aiName(tab.url)} — ${tab.title || tab.url}`;
      select.appendChild(opt);
    }
  }

  for (const [index, side] of SIDES.entries()) {
    const desired = previous[side] || latestState?.[`tab${side}`];
    if (!setSelectToTab(side, desired) && candidates[index]) {
      $(`tab${side}`).value = String(candidates[index].id);
    }
  }

  refreshStartLabels();
  if (candidates.length < 3) {
    $("status").textContent = "Open at least three supported AI chat tabs, then click Refresh AI tabs.";
  }
}

function hydrateFromState(s) {
  if (hydrated || !s) return;
  hydrated = true;

  for (const side of SIDES) {
    setSelectToTab(side, s[`tab${side}`]);
    if (s[`job${side}`]) $(`job${side}`).value = s[`job${side}`];
  }
  if (s.initialPrompt) $("prompt").value = s.initialPrompt;
  if (s.startSide && SIDES.includes(s.startSide)) $("startSide").value = s.startSide;
  if (Number.isInteger(Number(s.maxTurns))) $("maxTurns").value = String(s.maxTurns);
  if (Number.isFinite(Number(s.delayMs))) $("delayMs").value = String(s.delayMs);
  selectedSourceFiles = Array.isArray(s.sourceFiles) ? s.sourceFiles.map(file => ({ ...file })) : [];
  renderSourceFiles();
  renderHistory(s.history);
  refreshStartLabels();
}

function limitLabel(s) {
  return Number(s?.maxTurns) === -1 ? "∞" : String(s?.maxTurns ?? "?");
}

function currentLabel(s) {
  const side = s?.currentSide;
  if (!side) return "none";
  return `${s[`label${side}`] || "AI"} (AI ${side})`;
}

function updateSessionPill(s) {
  const pill = $("sessionPill");
  pill.className = "session-pill";
  if (s?.sessionActive && s.awaitingHuman) {
    pill.classList.add("paused");
    pill.textContent = "Needs human";
  } else if (s?.sessionActive && s.running) {
    pill.classList.add("running");
    pill.textContent = "Running";
  } else if (s?.sessionActive) {
    pill.classList.add("paused");
    pill.textContent = "Paused";
  } else {
    pill.classList.add("idle");
    pill.textContent = "Idle";
  }
}

function setHumanPanel(s) {
  const panel = $("humanPanel");
  if (s?.sessionActive && s.awaitingHuman && s.pendingHuman) {
    panel.classList.remove("hidden");
    $("humanWho").textContent = s.pendingHuman.requestingLabel || `AI ${s.pendingHuman.requestingSide || ""}`;
    $("humanQuestion").textContent = s.pendingHuman.prompt || "Human input requested.";
    $("sendHuman").disabled = false;
  } else {
    panel.classList.add("hidden");
    $("humanWho").textContent = "";
    $("humanQuestion").textContent = "";
  }
}

function clearTranscript() {
  $("transcript").querySelectorAll(".transcript-card").forEach(node => node.remove());
  renderedSeq = 0;
  $("emptyTranscript").classList.remove("hidden");
}

function transcriptCard(entry) {
  const card = document.createElement("article");
  const sideClass = entry.type === "human" ? "human" : String(entry.side || "").toLowerCase();
  card.className = `transcript-card side-${sideClass}`;
  card.dataset.seq = String(entry.seq);

  const head = document.createElement("div");
  head.className = "transcript-head";

  const title = document.createElement("div");
  title.className = "transcript-title";
  if (entry.type === "human") {
    title.textContent = "Human controller";
  } else {
    title.textContent = `AI ${entry.side || "?"} · ${entry.label || "AI"}`;
  }

  const meta = document.createElement("div");
  meta.className = "transcript-meta";
  const when = entry.time ? new Date(entry.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
  meta.textContent = `#${entry.seq}${when ? ` · ${when}` : ""}`;

  const body = document.createElement("div");
  body.className = "transcript-body";
  body.textContent = String(entry.text || "");

  head.append(title, meta);
  card.append(head, body);
  return card;
}

function renderTranscript(s) {
  const entries = Array.isArray(s?.transcript) ? s.transcript : [];
  const latestKnownSeq = Math.max(0, Number(s?.nextSeq || 1) - 1);

  if (latestKnownSeq < renderedSeq) {
    clearTranscript();
  }

  const fresh = entries.filter(e => Number(e.seq) > renderedSeq && (e.type === "response" || e.type === "human"));
  if (!fresh.length) return;

  $("emptyTranscript").classList.add("hidden");
  const fragment = document.createDocumentFragment();
  for (const entry of fresh) {
    fragment.appendChild(transcriptCard(entry));
    renderedSeq = Math.max(renderedSeq, Number(entry.seq) || 0);
  }
  $("transcript").appendChild(fragment);

  if (autoScroll) {
    $("transcript").scrollTop = $("transcript").scrollHeight;
  } else {
    $("jumpLatest").classList.remove("hidden");
  }
}

function humanFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function sourceTotalChars() {
  return selectedSourceFiles.reduce((sum, file) => sum + String(file.content || "").length, 0);
}

function setSourceNotice(message = "", isError = false) {
  const node = $("sourceNotice");
  node.textContent = message;
  node.classList.toggle("hidden", !message);
  node.classList.toggle("error", Boolean(message && isError));
}

function pathForFile(file) {
  return String(file.webkitRelativePath || file.name || "unnamed.txt").replace(/\\/g, "/");
}

function isIgnoredSourcePath(path) {
  return path.split("/").some(part => IGNORED_SOURCE_SEGMENTS.has(part));
}

function renderSourceFiles() {
  const list = $("sourceList");
  list.textContent = "";
  const totalChars = sourceTotalChars();
  $("sourceSummary").textContent = selectedSourceFiles.length
    ? `${selectedSourceFiles.length} file${selectedSourceFiles.length === 1 ? "" : "s"} · ${totalChars.toLocaleString()} chars`
    : "No files";
  $("clearSources").disabled = selectedSourceFiles.length === 0 || Boolean(latestState?.sessionActive);

  for (const file of selectedSourceFiles) {
    const row = document.createElement("div");
    row.className = "source-row";

    const info = document.createElement("div");
    info.className = "source-info";
    const name = document.createElement("div");
    name.className = "source-path";
    name.textContent = file.path;
    const meta = document.createElement("div");
    meta.className = "source-meta";
    meta.textContent = `${humanFileSize(file.size)} · ${String(file.content || "").length.toLocaleString()} chars`;
    info.append(name, meta);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "tiny ghost source-remove";
    remove.textContent = "Remove";
    remove.disabled = Boolean(latestState?.sessionActive);
    remove.addEventListener("click", () => {
      selectedSourceFiles = selectedSourceFiles.filter(item => item.path !== file.path);
      setSourceNotice();
      renderSourceFiles();
    });

    row.append(info, remove);
    list.appendChild(row);
  }
}

async function addLocalFiles(fileList) {
  if (latestState?.sessionActive) {
    setSourceNotice("Stop the current session before changing local source files.", true);
    return;
  }

  const incoming = [...(fileList || [])];
  if (!incoming.length) return;

  const byPath = new Map(selectedSourceFiles.map(file => [file.path, file]));
  let skipped = 0;
  const reasons = [];

  for (const file of incoming) {
    const path = pathForFile(file);
    if (isIgnoredSourcePath(path)) { skipped++; continue; }
    if (file.size > MAX_SOURCE_FILE_BYTES) {
      skipped++;
      reasons.push(`${path} is over ${humanFileSize(MAX_SOURCE_FILE_BYTES)}`);
      continue;
    }
    if (!byPath.has(path) && byPath.size >= MAX_SOURCE_FILES) {
      skipped += incoming.length - incoming.indexOf(file);
      reasons.push(`Only the first ${MAX_SOURCE_FILES} source files can be attached`);
      break;
    }

    const content = await file.text();
    if (content.includes("\0")) {
      skipped++;
      reasons.push(`${path} appears to be binary`);
      continue;
    }
    if (content.length > MAX_SOURCE_FILE_CHARS) {
      skipped++;
      reasons.push(`${path} exceeds ${MAX_SOURCE_FILE_CHARS.toLocaleString()} characters`);
      continue;
    }

    const existingChars = [...byPath.values()]
      .filter(item => item.path !== path)
      .reduce((sum, item) => sum + String(item.content || "").length, 0);
    if (existingChars + content.length > MAX_SOURCE_TOTAL_CHARS) {
      skipped++;
      reasons.push(`${path} would exceed the ${MAX_SOURCE_TOTAL_CHARS.toLocaleString()} character combined limit`);
      continue;
    }

    byPath.set(path, { path, size: file.size, content });
  }

  selectedSourceFiles = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  const message = skipped
    ? `Added ${selectedSourceFiles.length} total source file${selectedSourceFiles.length === 1 ? "" : "s"}; skipped ${skipped}.${reasons.length ? ` ${reasons.slice(0, 3).join("; ")}${reasons.length > 3 ? "; …" : ""}` : ""}`
    : `${selectedSourceFiles.length} local source file${selectedSourceFiles.length === 1 ? "" : "s"} ready.`;
  setSourceNotice(message, skipped > 0 && selectedSourceFiles.length === 0);
  renderSourceFiles();
}

function updateControls(s) {
  $("start").disabled = Boolean(s.sessionActive);
  $("pickFiles").disabled = Boolean(s.sessionActive);
  $("pickFolder").disabled = Boolean(s.sessionActive);
  $("sourceDropZone").classList.toggle("disabled", Boolean(s.sessionActive));
  $("clearSources").disabled = Boolean(s.sessionActive) || selectedSourceFiles.length === 0;
  $("sourceList").querySelectorAll(".source-remove").forEach(button => { button.disabled = Boolean(s.sessionActive); });
  $("pause").disabled = !s.sessionActive || !s.running || s.awaitingHuman;
  $("resume").disabled = !s.sessionActive || s.running || s.awaitingHuman;
  $("stop").disabled = !s.sessionActive;

  for (const side of SIDES) {
    $(`resend${side}`).disabled = !s.sessionActive || !s.running || s.awaitingHuman || !s.lastSentBySide?.[side];
  }
  $("jobHistory").querySelectorAll(".history-use").forEach(button => { button.disabled = Boolean(s.sessionActive); });
  $("commandHistory").querySelectorAll(".history-use").forEach(button => { button.disabled = Boolean(s.sessionActive); });
}

function updateStatus(s) {
  const limit = limitLabel(s);
  $("turnCounter").textContent = `${s.turn || 0} / ${limit}`;
  updateSessionPill(s);

  if (s.sessionActive && s.awaitingHuman && s.pendingHuman) {
    $("status").textContent = `PAUSED — HUMAN INPUT NEEDED\nWaiting on controller for ${s.pendingHuman.requestingLabel || `AI ${s.pendingHuman.requestingSide}`}.`;
  } else if (s.sessionActive && s.running) {
    $("status").textContent = `Running\nWaiting on: ${currentLabel(s)}\nAI turns: ${s.turn}/${limit}`;
  } else if (s.sessionActive && s.paused) {
    $("status").textContent = `PAUSED — ${s.pauseReason || "Session saved."}\nNext/current: ${currentLabel(s)}\nAI turns: ${s.turn}/${limit}`;
  } else {
    const last = s.log?.length ? s.log[s.log.length - 1]?.text : "";
    $("status").textContent = `Idle${last ? ` — ${last}` : ""}`;
  }
}

async function refreshState() {
  try {
    const res = await chrome.runtime.sendMessage({
      type: "AI_BRIDGE_GET_STATE",
      includeSources: !hydrated,
      afterSeq: renderedSeq
    });
    const s = res?.state;
    if (!s) return;
    latestState = s;
    hydrateFromState(s);
    renderHistory(s.history);
    updateStatus(s);
    updateControls(s);
    setHumanPanel(s);
    renderTranscript(s);
  } catch (err) {
    $("status").textContent = `Bridge state error: ${err.message}`;
  }
}

function selectedBindings() {
  const data = {};
  for (const side of SIDES) {
    const tabId = selectedTab(side);
    const tab = tabsById.get(tabId);
    data[`tab${side}`] = tabId;
    data[`label${side}`] = aiName(tab?.url);
  }
  return data;
}

function validateThreeTabs() {
  const ids = SIDES.map(selectedTab);
  if (ids.some(id => !id)) return "Choose three supported AI tabs.";
  if (new Set(ids).size !== 3) return "AI A, AI B, and AI C must be three different tabs.";
  return null;
}

function validateMaxTurns() {
  const input = $("maxTurns");
  input.classList.remove("validation-error");
  const raw = input.value.trim();
  const value = Number(raw);
  const valid = raw !== "" && Number.isInteger(value) && (value === -1 || (value >= 1 && value <= 10000));
  if (!valid) {
    input.classList.add("validation-error");
    return "Max AI turns must be -1 (infinite) or an integer from 1 to 10000.";
  }
  return null;
}

$("themeSelect").addEventListener("change", async event => {
  const theme = THEMES.has(event.target.value) ? event.target.value : "midnight";
  applyTheme(theme);
  await chrome.storage.local.set({ [THEME_KEY]: theme });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[THEME_KEY]) applyTheme(changes[THEME_KEY].newValue);
});

async function clearHistory(kind) {
  const res = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_CLEAR_HISTORY", kind });
  if (!res?.ok) {
    $("status").textContent = `Could not clear history: ${res?.error || "Unknown error"}`;
    return;
  }
  await refreshState();
}

$("clearJobHistory").addEventListener("click", () => clearHistory("jobs"));
$("clearCommandHistory").addEventListener("click", () => clearHistory("commands"));

for (const side of SIDES) $(`tab${side}`).addEventListener("change", refreshStartLabels);
$("maxTurns").addEventListener("input", () => $("maxTurns").classList.remove("validation-error"));

$("start").addEventListener("click", async () => {
  const tabError = validateThreeTabs();
  if (tabError) return $("status").textContent = tabError;
  const turnError = validateMaxTurns();
  if (turnError) return $("status").textContent = turnError;

  const initialPrompt = $("prompt").value.trim();
  if (!initialPrompt) return $("status").textContent = "Enter a primary objective or initial prompt.";

  $("status").textContent = "Starting three-AI session…";
  try {
    const res = await chrome.runtime.sendMessage({
      type: "AI_BRIDGE_START",
      ...selectedBindings(),
      startSide: $("startSide").value,
      jobA: $("jobA").value.trim(),
      jobB: $("jobB").value.trim(),
      jobC: $("jobC").value.trim(),
      initialPrompt,
      sourceFiles: selectedSourceFiles.map(file => ({ path: file.path, size: file.size, content: file.content })),
      maxTurns: Number($("maxTurns").value),
      delayMs: Number($("delayMs").value)
    });
    if (!res?.ok) throw new Error(res?.error || "Could not start");
    clearTranscript();
    await refreshState();
  } catch (err) {
    $("status").textContent = `Start failed: ${err.message}`;
  }
});

$("pause").addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_PAUSE" });
  if (!res?.ok) $("status").textContent = `Pause failed: ${res?.error || "Unknown error"}`;
  await refreshState();
});

$("resume").addEventListener("click", async () => {
  const tabError = validateThreeTabs();
  if (tabError) return $("status").textContent = `${tabError}\nTo resume, bind all three roles to open AI tabs.`;

  $("status").textContent = "Restoring saved session…";
  try {
    const res = await chrome.runtime.sendMessage({
      type: "AI_BRIDGE_RESUME",
      ...selectedBindings()
    });
    if (!res?.ok) throw new Error(res?.error || "Could not resume");
    await refreshState();
  } catch (err) {
    $("status").textContent = `Resume failed: ${err.message}`;
  }
});

$("stop").addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_STOP" });
  if (!res?.ok) $("status").textContent = `Stop failed: ${res?.error || "Unknown error"}`;
  await refreshState();
});

async function resend(side) {
  const button = $(`resend${side}`);
  button.disabled = true;
  const old = button.textContent;
  button.textContent = "Resending…";
  try {
    const res = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_RESEND", side });
    if (!res?.ok) throw new Error(res?.error || "Resend failed");
  } catch (err) {
    $("status").textContent = `Resend failed: ${err.message}`;
  } finally {
    button.textContent = old;
    await refreshState();
  }
}
for (const side of SIDES) $(`resend${side}`).addEventListener("click", () => resend(side));

$("sendHuman").addEventListener("click", async () => {
  const text = $("humanResponse").value.trim();
  if (!text) return $("status").textContent = "Type your response to the AI first.";

  $("sendHuman").disabled = true;
  $("sendHuman").textContent = "Sending…";
  try {
    const res = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_HUMAN_REPLY", text });
    if (!res?.ok) throw new Error(res?.error || "Could not send human response");
    $("humanResponse").value = "";
  } catch (err) {
    $("status").textContent = `Human response failed: ${err.message}`;
  } finally {
    $("sendHuman").textContent = "Send response & continue";
    await refreshState();
  }
});

$("pickFiles").addEventListener("click", () => $("sourceFileInput").click());
$("pickFolder").addEventListener("click", () => $("sourceFolderInput").click());
$("clearSources").addEventListener("click", () => {
  if (latestState?.sessionActive) return;
  selectedSourceFiles = [];
  setSourceNotice();
  renderSourceFiles();
});
$("sourceFileInput").addEventListener("change", async event => {
  await addLocalFiles(event.target.files);
  event.target.value = "";
});
$("sourceFolderInput").addEventListener("change", async event => {
  await addLocalFiles(event.target.files);
  event.target.value = "";
});
for (const type of ["dragenter", "dragover"]) {
  $("sourceDropZone").addEventListener(type, event => {
    event.preventDefault();
    if (!latestState?.sessionActive) $("sourceDropZone").classList.add("dragging");
  });
}
for (const type of ["dragleave", "drop"]) {
  $("sourceDropZone").addEventListener(type, event => {
    event.preventDefault();
    $("sourceDropZone").classList.remove("dragging");
  });
}
$("sourceDropZone").addEventListener("drop", async event => {
  if (latestState?.sessionActive) return;
  await addLocalFiles(event.dataTransfer?.files);
});
$("sourceDropZone").addEventListener("keydown", event => {
  if (latestState?.sessionActive) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    $("sourceFileInput").click();
  }
});

$("refreshTabs").addEventListener("click", async () => {
  await loadTabs({ preserve: true });
  await refreshState();
});

$("transcript").addEventListener("scroll", () => {
  const el = $("transcript");
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
  autoScroll = distance < 90;
  $("jumpLatest").classList.toggle("hidden", autoScroll);
});

$("jumpLatest").addEventListener("click", () => {
  autoScroll = true;
  const el = $("transcript");
  el.scrollTop = el.scrollHeight;
  $("jumpLatest").classList.add("hidden");
});

Promise.all([loadTheme(), loadTabs({ preserve: false })]).then(refreshState);
setInterval(refreshState, 750);
