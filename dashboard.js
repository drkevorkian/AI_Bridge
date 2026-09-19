const ALL_SIDES = ["A", "B", "C", "D", "E"];
const DEFAULT_AGENT_COUNT = 3;
let SIDES = ALL_SIDES.slice(0, DEFAULT_AGENT_COUNT);
const supported = [
  { re: /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//, name: "ChatGPT" },
  { re: /^https:\/\/grok\.com\//, name: "Grok" },
  { re: /^https:\/\/claude\.ai\//, name: "Claude" },
  { re: /^https:\/\/gemini\.google\.com\//, name: "Gemini" },
  { re: /^https:\/\/copilot\.microsoft\.com\//, name: "Copilot" }
];

const $ = id => document.getElementById(id);
const THEME_KEY = "aiBridgeTheme";
const AGENT_COUNT_KEY = "aiBridgeAgentCount";
const THEMES = new Set(["blizzard", "ghostwhite", "midnight", "slate", "light", "solarized", "ocean", "terminal"]);
let tabsById = new Map();
let latestState = null;
let hydrated = false;
let renderedSeq = 0;
let autoScroll = true;
let selectedSourceFiles = [];
let activeHumanModalKey = "";
const WORK_MODE_INFO = {
  relay: { label: "Relay" },
  collaborate: { label: "Collaborate" },
  compete: { label: "Compete" },
  parallel: { label: "Parallel Independent" },
  review: { label: "Peer Review" },
  mesh: { label: "Direct Mesh" }
};

function normalizeAgentCount(raw) {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= ALL_SIDES.length ? value : DEFAULT_AGENT_COUNT;
}

function minimumTurnsForMode(mode = selectedWorkMode()) {
  if (mode === "review") return SIDES.length * 2;
  if (mode === "compete" || mode === "parallel") return SIDES.length;
  return 1;
}

function modeHelp(mode = selectedWorkMode()) {
  const count = SIDES.length;
  if (mode === "relay") return "Normal sequential " + SIDES.join(" → ") + " relay. Each AI receives shared updates from the previous agents.";
  if (mode === "collaborate") return "Sequential shared-deliverable mode. Each active AI improves one common result using its assigned specialty.";
  if (mode === "compete") return "All " + count + " active AIs receive the same objective simultaneously and submit independently.";
  if (mode === "parallel") return "All " + count + " active AIs work simultaneously and independently on complementary versions of the same objective.";
  if (mode === "review") return "Phase 1: all " + count + " active AIs answer independently. Phase 2: each AI receives the other active responses and critiques them simultaneously.";
  return "One AI speaks at a time, but each model can route its completed response directly to a specific active teammate with a final-line SEND TO command.";
}

function setAgentCountUI(raw, { persist = false } = {}) {
  const count = normalizeAgentCount(raw);
  SIDES = ALL_SIDES.slice(0, count);
  if ($("agentCount")) $("agentCount").value = String(count);
  if ($("teamRouteLabel")) $("teamRouteLabel").textContent = SIDES.join(" → ");
  for (const side of ALL_SIDES) {
    const active = SIDES.includes(side);
    const card = $("agentCard" + side);
    if (card) card.hidden = !active;
    const option = [...($("startSide")?.options || [])].find(item => item.value === side);
    if (option) {
      option.hidden = !active;
      option.disabled = !active;
    }
  }
  if ($("startSide") && !SIDES.includes($("startSide").value)) $("startSide").value = SIDES[0];
  const relayOption = [...($("workMode")?.options || [])].find(item => item.value === "relay");
  if (relayOption) relayOption.textContent = "Relay — " + SIDES.join(" → ");
  updateWorkModeUI();
  refreshStartLabels();
  if (latestState) renderHistory(latestState.history);
  updateManualRelayUI();
  if (persist) chrome.storage.local.set({ [AGENT_COUNT_KEY]: count }).catch(() => {});
  return count;
}

async function loadAgentCountPreference() {
  try {
    const stored = await chrome.storage.local.get(AGENT_COUNT_KEY);
    setAgentCountUI(stored?.[AGENT_COUNT_KEY] ?? DEFAULT_AGENT_COUNT);
  } catch (_) {
    setAgentCountUI(DEFAULT_AGENT_COUNT);
  }
}

function selectedWorkMode() {
  const value = $("workMode")?.value || "relay";
  return WORK_MODE_INFO[value] ? value : "relay";
}

function updateWorkModeUI() {
  const mode = selectedWorkMode();
  const minTurns = minimumTurnsForMode(mode);
  if ($("workModeHelp")) $("workModeHelp").textContent = modeHelp(mode);
  const batch = ["compete", "parallel", "review"].includes(mode);
  $("startSide").disabled = Boolean(latestState?.sessionActive);
  $("startSide").title = batch
    ? "All " + SIDES.length + " active AIs start simultaneously; this selection still defines the Main AI for queued human interjections."
    : "Choose the first speaker and Main AI for queued human interjections.";
  const maxHelp = $("maxTurns")?.parentElement?.querySelector(".field-help");
  if (maxHelp) {
    maxHelp.innerHTML = "<strong>-1 = Infinite</strong> · " + (minTurns > 1 ? (minTurns + "–10000 for this mode") : "1–10000 = finite");
  }
}

const MAX_SOURCE_FILES = 100;
const MAX_SOURCE_FILE_BYTES = 512 * 1024;
const MAX_SOURCE_FILE_CHARS = 200000;
const MAX_SOURCE_TOTAL_CHARS = 400000;
const IGNORED_SOURCE_SEGMENTS = new Set([".git", "node_modules", ".venv", "venv", "__pycache__", ".next", "dist", "build"]);

function applyTheme(theme) {
  const chosen = THEMES.has(theme) ? theme : "blizzard";
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

      const useGroup = document.createElement("div");
      useGroup.className = "history-use-group";
      for (const targetSide of SIDES) {
        const use = document.createElement("button");
        use.type = "button";
        use.className = "tiny ghost history-use";
        use.textContent = targetSide;
        use.title = `Apply this role to AI ${targetSide}`;
        use.disabled = locked;
        use.addEventListener("click", () => {
          if (!locked) $(`job${targetSide}`).value = item.job || "";
        });
        useGroup.appendChild(use);
      }

      row.append(badge, copy, useGroup);
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
  for (const side of ALL_SIDES) {
    const tab = tabsById.get(selectedTab(side));
    const option = [...$("startSide").options].find(o => o.value === side);
    if (option) option.textContent = `${aiName(tab?.url)} (AI ${side}) — Main`;
  }
}

async function loadTabs({ preserve = true } = {}) {
  const previous = {};
  if (preserve) for (const side of ALL_SIDES) previous[side] = selectedTab(side);

  const tabs = await chrome.tabs.query({});
  const candidates = tabs.filter(t => supported.some(x => x.re.test(t.url || "")));
  tabsById = new Map(candidates.map(t => [t.id, t]));

  for (const side of ALL_SIDES) {
    const select = $(`tab${side}`);
    select.textContent = "";
    for (const tab of candidates) {
      const opt = document.createElement("option");
      opt.value = String(tab.id);
      opt.textContent = `${aiName(tab.url)} — ${tab.title || tab.url}`;
      select.appendChild(opt);
    }
  }

  for (const [index, side] of ALL_SIDES.entries()) {
    const desired = previous[side] || latestState?.[`tab${side}`];
    if (!setSelectToTab(side, desired) && candidates[index]) {
      $(`tab${side}`).value = String(candidates[index].id);
    }
  }

  for (const option of $("agentCount").options) {
    option.disabled = Number(option.value) > candidates.length;
  }
  $("agentCountHelp").textContent = `${candidates.length} supported AI tab${candidates.length === 1 ? "" : "s"} currently open. Multiple tabs from the same LLM are allowed and count as separate agents.`;

  refreshStartLabels();
  if (candidates.length < SIDES.length) {
    $("status").textContent = `Open at least ${SIDES.length} supported AI tab${SIDES.length === 1 ? "" : "s"}, then click Refresh AI tabs.`;
  }
}

function hydrateFromState(s) {
  if (hydrated || !s) return;
  hydrated = true;

  if (s.sessionActive) setAgentCountUI(s.agentCount);
  for (const side of ALL_SIDES) {
    setSelectToTab(side, s[`tab${side}`]);
    if (s[`job${side}`]) $(`job${side}`).value = s[`job${side}`];
  }
  if (s.initialPrompt) $("prompt").value = s.initialPrompt;
  if (typeof s.teamRules === "string") $("teamRules").value = s.teamRules;
  if (s.startSide && SIDES.includes(s.startSide)) $("startSide").value = s.startSide;
  if (s.workMode && WORK_MODE_INFO[s.workMode]) $("workMode").value = s.workMode;
  updateWorkModeUI();
  if (Number.isInteger(Number(s.maxTurns))) $("maxTurns").value = String(s.maxTurns);
  if (Number.isFinite(Number(s.delayMs))) $("delayMs").value = String(s.delayMs);
  selectedSourceFiles = Array.isArray(s.sourceFiles) ? s.sourceFiles.map(file => ({ ...file })) : [];
  renderSourceFiles();
  renderHistory(s.history);
  refreshStartLabels();
}


function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function renderRelayArtifacts(items = latestState?.relayArtifacts) {
  const list = $("relayArtifacts");
  const artifacts = Array.isArray(items) ? items : [];
  list.textContent = "";
  const storedBytes = artifacts.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
  $("relaySummary").textContent = artifacts.length ? `${artifacts.length} stored · ${formatBytes(storedBytes)}` : "No stored files";
  if (!artifacts.length) {
    list.appendChild(historyEmpty("No AI-generated files captured yet."));
    return;
  }

  for (const item of [...artifacts].reverse()) {
    const side = String(item.sourceSide || "?").toLowerCase();
    const row = document.createElement("div");
    row.className = `relay-row relay-side-${side}`;

    const badge = document.createElement("span");
    badge.className = `vault-source-badge side-${side}`;
    badge.textContent = item.sourceSide ? `AI ${item.sourceSide}` : "AI";

    const copy = document.createElement("div");
    copy.className = "relay-copy";
    const name = document.createElement("div");
    name.className = "relay-name";
    name.textContent = item.name || "artifact";
    const meta = document.createElement("div");
    meta.className = "relay-meta";
    const status = item.status || (item.extractedFileCount ? "Extracted" : "Raw file");
    meta.textContent = `${status} · ${formatBytes(item.size)} · #${item.seq || "?"}`;
    copy.append(name, meta);

    const actions = document.createElement("div");
    actions.className = "relay-actions";
    const download = document.createElement("button");
    download.type = "button";
    download.className = "tiny ghost relay-download";
    download.textContent = "Download";
    download.title = `Download ${item.name || "artifact"}`;
    download.addEventListener("click", async () => {
      download.disabled = true;
      const old = download.textContent;
      download.textContent = "Saving…";
      try {
        const res = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_DOWNLOAD_ARTIFACT", id: item.id, saveAs: true });
        if (!res?.ok) throw new Error(res?.error || "Download failed");
        $("status").textContent = `Download started: ${item.name || "artifact"}`;
      } catch (err) {
        $("status").textContent = `Vault download failed: ${err.message}`;
      } finally {
        download.textContent = old;
        download.disabled = false;
      }
    });
    actions.appendChild(download);

    row.append(badge, copy, actions);
    list.appendChild(row);
  }
}

function artifactMetadataMap() {
  return new Map((latestState?.relayArtifacts || []).map(item => [item.id, item]));
}

function attachmentChips(entry) {
  const ids = Array.isArray(entry?.artifactIds) ? entry.artifactIds : [];
  if (!ids.length) return null;
  const map = artifactMetadataMap();
  const wrap = document.createElement("div");
  wrap.className = "vault-chips";
  for (const id of ids) {
    const item = map.get(id);
    const chip = document.createElement("span");
    const side = String(entry.side || item?.sourceSide || "?").toLowerCase();
    chip.className = `vault-chip relay-side-${side}`;
    const label = item?.name || "Vault file";
    const status = item?.status ? ` · ${item.status}` : "";
    chip.textContent = `Vault Upload · ${label}${status}`;
    wrap.appendChild(chip);
  }
  return wrap;
}

function limitLabel(s) {
  return Number(s?.maxTurns) === -1 ? "∞" : String(s?.maxTurns ?? "?");
}

function currentLabel(s) {
  const side = s?.currentSide;
  if (!side) return "none";
  return `${s[`label${side}`] || "AI"} (AI ${side})`;
}

function formatRoundDuration(ms, live = false) {
  const value = Math.max(0, Number(ms) || 0);
  if (value < 60000) return `${(value / 1000).toFixed(live ? 1 : (value < 10000 ? 2 : 1))}s`;
  const totalSeconds = Math.floor(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((value % 1000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function updateRoundTimers(s = latestState) {
  const now = Date.now();
  for (const side of SIDES) {
    const totalNode = $(`timerTotal${side}`);
    const currentNode = $(`timerCurrent${side}`);
    if (!totalNode || !currentNode) continue;
    const startedAt = Number(s?.roundStartedAtBySide?.[side]);
    const roundNumber = Math.max(0, Number(s?.roundNumberBySide?.[side]) || 0);
    const lastDuration = Number(s?.lastRoundDurationMsBySide?.[side]);
    const storedTotal = Math.max(0, Number(s?.totalWorkMsBySide?.[side]) || 0);
    const active = Boolean(s?.sessionActive && Number.isFinite(startedAt) && startedAt > 0);
    const liveMs = active ? Math.max(0, now - startedAt) : 0;

    totalNode.textContent = `Total ${formatRoundDuration(storedTotal + liveMs, active)}`;
    totalNode.classList.toggle("active", active);
    totalNode.classList.toggle("idle", !active);

    currentNode.classList.toggle("active", active);
    currentNode.classList.toggle("idle", !active);
    if (active) {
      currentNode.textContent = `Current R${roundNumber} · ${formatRoundDuration(liveMs, true)}`;
      currentNode.title = `Round ${roundNumber} active · extension timer started when the prompt was submitted`;
    } else if (roundNumber > 0 && Number.isFinite(lastDuration) && lastDuration >= 0) {
      currentNode.textContent = `Last R${roundNumber} · ${formatRoundDuration(lastDuration)}`;
      currentNode.title = `Last completed round ${roundNumber} · extension-measured prompt-to-final-response time`;
    } else {
      currentNode.textContent = "Current —";
      currentNode.title = "No extension-measured round has completed yet";
    }
  }
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

function renderSuppressedRequests(s = latestState) {
  const list = $("suppressedRequests");
  if (!list) return;
  const items = Array.isArray(s?.suppressedHumanRequests) ? s.suppressedHumanRequests : [];
  $("suppressedSummary").textContent = items.length ? `${items.length} waiting` : "None";
  if (items.length) $("suppressedPanel").open = true;
  list.textContent = "";
  if (!items.length) {
    list.appendChild(historyEmpty("No suppressed requests."));
    return;
  }
  for (const item of [...items].reverse()) {
    const row = document.createElement("div");
    row.className = "suppressed-row";
    const copy = document.createElement("div");
    copy.className = "suppressed-copy";
    const title = document.createElement("div");
    title.className = "history-title";
    title.textContent = `${item.requestingLabel || `AI ${item.requestingSide || "?"}`} · ${formatHistoryTime(item.suppressedAt || item.time)}`;
    const question = document.createElement("div");
    question.className = "suppressed-question";
    question.textContent = item.prompt || "Human input requested.";
    copy.append(title, question);

    const answer = document.createElement("button");
    answer.type = "button";
    answer.className = "tiny resume suppressed-answer";
    answer.textContent = "Answer";
    answer.disabled = !s?.sessionActive || Boolean(s?.awaitingHuman);
    answer.addEventListener("click", async () => {
      answer.disabled = true;
      const old = answer.textContent;
      answer.textContent = "Opening…";
      try {
        const res = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_HUMAN_REOPEN", requestId: item.id });
        if (!res?.ok) throw new Error(res?.error || "Could not reopen request");
        await refreshState();
      } catch (err) {
        $("status").textContent = `Could not reopen suppressed request: ${err.message}`;
        answer.disabled = false;
        answer.textContent = old;
      }
    });
    row.append(copy, answer);
    list.appendChild(row);
  }
}

function setHumanModal(s) {
  const modal = $("humanModal");
  const request = s?.sessionActive && s.awaitingHuman ? s.pendingHuman : null;
  if (!request) {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    activeHumanModalKey = "";
    return;
  }

  const key = `${request.time || ""}:${request.requestingSide || ""}:${request.prompt || ""}`;
  $("humanModalWho").textContent = request.requestingLabel || `AI ${request.requestingSide || ""}`;
  $("humanModalQuestion").textContent = request.prompt || "Human input requested.";
  const queued = Array.isArray(s.pendingHumanQueue) ? s.pendingHumanQueue.length : 0;
  $("humanModalQueue").textContent = queued ? `${queued} additional human-input request${queued === 1 ? "" : "s"} queued behind this one.` : "The bridge is paused until this request is answered.";
  $("sendHumanModal").disabled = false;
  $("suppressHumanModal").disabled = false;
  $("stopHumanModal").disabled = false;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");

  if (key !== activeHumanModalKey) {
    activeHumanModalKey = key;
    $("humanModalResponse").value = "";
    setTimeout(() => $("humanModalResponse").focus(), 0);
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
    title.textContent = entry.interjection ? "Human controller · interjection" : "Human controller";
  } else {
    title.textContent = `AI ${entry.side || "?"} · ${entry.label || "AI"}`;
  }

  const meta = document.createElement("div");
  meta.className = "transcript-meta";
  const when = entry.time ? new Date(entry.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
  const phase = entry.workPhase && !["relay", "collaborate"].includes(entry.workPhase) ? ` · ${String(entry.workPhase).toUpperCase()}` : "";
  const elapsed = Number.isFinite(Number(entry.roundDurationMs)) ? ` · ${formatRoundDuration(Number(entry.roundDurationMs))}` : "";
  const round = Number.isFinite(Number(entry.roundNumber)) && Number(entry.roundNumber) > 0 ? ` · R${Number(entry.roundNumber)}` : "";
  meta.textContent = `#${entry.seq}${phase}${round}${elapsed}${when ? ` · ${when}` : ""}`;

  const body = document.createElement("div");
  body.className = "transcript-body";
  body.textContent = String(entry.text || "");

  head.append(title, meta);
  card.append(head, body);
  if (entry.directToSide) {
    const route = document.createElement("div");
    route.className = "direct-route-badge";
    route.textContent = `SEND TO · AI ${entry.side || "?"} → AI ${entry.directToSide} · ${entry.directToLabel || "AI"}`;
    card.appendChild(route);
  } else if (entry.bridgeCommand === "send-to" && entry.commandValid === false) {
    const route = document.createElement("div");
    route.className = "direct-route-badge route-error";
    route.textContent = `SEND TO rejected · ${entry.directTargetRaw || "unknown target"}`;
    card.appendChild(route);
  }
  const chips = attachmentChips(entry);
  if (chips) card.appendChild(chips);
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
  $("newAllChats").disabled = Boolean(s.sessionActive);
  $("freshOnStart").disabled = Boolean(s.sessionActive);
  $("agentCount").disabled = Boolean(s.sessionActive);
  $("workMode").disabled = Boolean(s.sessionActive);
  $("teamRules").disabled = false;
  $("applyTeamRules").disabled = false;
  $("forceRelayBtn").disabled = !s.sessionActive || s.running || s.awaitingHuman || selectedManualRelayTargets().length === 0;
  $("sendInterject").disabled = !s.sessionActive || s.awaitingHuman;
  $("interjectText").disabled = !s.sessionActive || s.awaitingHuman;
  $("interjectNow").disabled = !s.sessionActive || s.awaitingHuman;
  updateWorkModeUI();

  for (const side of SIDES) {
    $(`newChat${side}`).disabled = Boolean(s.sessionActive) || !selectedTab(side);
    const batchDone = ["compete", "parallel", "review"].includes(s.workMode) && Array.isArray(s.phaseCompletedSides) && s.phaseCompletedSides.includes(side);
    $(`resend${side}`).disabled = !s.sessionActive || !s.running || s.awaitingHuman || !s.lastSentBySide?.[side] || batchDone;
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
    const batch = ["compete", "parallel", "review"].includes(s.workMode);
    if (batch) {
      const pending = Array.isArray(s.phasePendingSides) && s.phasePendingSides.length ? s.phasePendingSides.map(side => `AI ${side}`).join(", ") : "phase transition";
      $("status").textContent = `Running — ${WORK_MODE_INFO[s.workMode]?.label || s.workMode} / ${String(s.workPhase || "primary").toUpperCase()}\nWaiting on: ${pending}\nAI turns: ${s.turn}/${limit}`;
    } else {
      $("status").textContent = `Running — ${WORK_MODE_INFO[s.workMode]?.label || "Relay"}\nWaiting on: ${currentLabel(s)}\nAI turns: ${s.turn}/${limit}`;
    }
  } else if (s.sessionActive && s.paused) {
    const batch = ["compete", "parallel", "review"].includes(s.workMode);
    const next = batch ? ((s.phasePendingSides || []).map(side => `AI ${side}`).join(", ") || "phase transition") : currentLabel(s);
    const suppressed = Array.isArray(s.suppressedHumanRequests) ? s.suppressedHumanRequests.length : 0;
    $("status").textContent = `PAUSED — ${s.pauseReason || "Session saved."}\nNext/current: ${next}\nAI turns: ${s.turn}/${limit}${suppressed ? `\nSuppressed human requests: ${suppressed}` : ""}`;
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
    renderRelayArtifacts(s.relayArtifacts);
    renderSuppressedRequests(s);
    updateRoundTimers(s);
    updateStatus(s);
    updateControls(s);
    setHumanModal(s);
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

function validateActiveTabs() {
  const ids = SIDES.map(selectedTab);
  if (ids.some(id => !id)) return `Choose ${SIDES.length} supported AI tab${SIDES.length === 1 ? "" : "s"}.`;
  if (new Set(ids).size !== ids.length) return "Each logical AI must use a different browser tab. Multiple tabs from the same LLM are allowed.";
  return null;
}

let manualRelaySource = "A";

function updateManualRelayUI() {
  if (!SIDES.includes(manualRelaySource)) manualRelaySource = SIDES[0];
  for (const side of ALL_SIDES) {
    const active = SIDES.includes(side);
    const from = $(`forceFrom${side}`);
    const to = $(`forceTo${side}`);
    if (from) {
      from.hidden = !active;
      from.disabled = !active;
      from.classList.toggle("active", active && side === manualRelaySource);
      from.setAttribute("aria-pressed", String(active && side === manualRelaySource));
    }
    if (to) {
      to.closest("label").hidden = !active;
      to.disabled = !active || side === manualRelaySource;
      if (!active || side === manualRelaySource) to.checked = false;
    }
  }
}

function selectedManualRelayTargets() {
  return SIDES.filter(side => side !== manualRelaySource && $(`forceTo${side}`)?.checked);
}

function validateMaxTurns() {
  const input = $("maxTurns");
  input.classList.remove("validation-error");
  const raw = input.value.trim();
  const value = Number(raw);
  const mode = selectedWorkMode();
  const minTurns = minimumTurnsForMode(mode);
  const valid = raw !== "" && Number.isInteger(value) && (value === -1 || (value >= minTurns && value <= 10000));
  if (!valid) {
    input.classList.add("validation-error");
    return `${WORK_MODE_INFO[mode]?.label || "This"} mode requires -1 (infinite) or an integer from ${minTurns} to 10000.`;
  }
  return null;
}

$("themeSelect").addEventListener("change", async event => {
  const theme = THEMES.has(event.target.value) ? event.target.value : "blizzard";
  applyTheme(theme);
  await chrome.storage.local.set({ [THEME_KEY]: theme });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[THEME_KEY]) applyTheme(changes[THEME_KEY].newValue);
});

async function openFreshChats(sides) {
  if (latestState?.sessionActive) return;
  const chosen = Array.isArray(sides) ? sides : SIDES;
  const tabError = validateActiveTabs();
  if (chosen.length === SIDES.length && tabError) {
    $("status").textContent = tabError;
    return;
  }

  const oldLabels = new Map();
  for (const side of chosen) {
    const button = chosen.length === 1 ? $(`newChat${side}`) : null;
    if (button) { oldLabels.set(button, button.textContent); button.textContent = "Opening…"; button.disabled = true; }
  }
  if (chosen.length === SIDES.length) { oldLabels.set($("newAllChats"), $("newAllChats").textContent); $("newAllChats").textContent = "Opening…"; $("newAllChats").disabled = true; }

  try {
    const payload = { type: "AI_BRIDGE_NEW_CHATS", sides: chosen };
    for (const side of chosen) {
      payload[`tab${side}`] = selectedTab(side);
      if (!payload[`tab${side}`]) throw new Error(`Choose an open AI tab for AI ${side}.`);
    }
    const res = await chrome.runtime.sendMessage(payload);
    if (!res?.ok) throw new Error(res?.error || "Could not open fresh AI chat.");
    $("status").textContent = `Fresh chat${chosen.length === 1 ? "" : "s"} opened for AI ${chosen.join(", AI ")}.`;
    await loadTabs({ preserve: true });
    await refreshState();
  } catch (err) {
    $("status").textContent = `New chat failed: ${err.message}`;
  } finally {
    for (const [button, label] of oldLabels) button.textContent = label;
  }
}

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

for (const side of ALL_SIDES) {
  $(`tab${side}`).addEventListener("change", () => { refreshStartLabels(); if (latestState) updateControls(latestState); });
  $(`newChat${side}`).addEventListener("click", () => openFreshChats([side]));
}
$("newAllChats").addEventListener("click", () => openFreshChats([...SIDES]));
$("agentCount").addEventListener("change", async event => {
  if (latestState?.sessionActive) {
    event.target.value = String(latestState.agentCount || SIDES.length);
    return;
  }
  const requested = normalizeAgentCount(event.target.value);
  if (tabsById.size && requested > tabsById.size) {
    $("status").textContent = `Only ${tabsById.size} supported AI tab${tabsById.size === 1 ? "" : "s"} are open.`;
    event.target.value = String(Math.min(SIDES.length, tabsById.size));
    return;
  }
  setAgentCountUI(requested, { persist: true });
  await loadTabs({ preserve: true });
  if (latestState) updateControls(latestState);
});
$("workMode").addEventListener("change", () => {
  updateWorkModeUI();
  $("maxTurns").classList.remove("validation-error");
});
$("maxTurns").addEventListener("input", () => $("maxTurns").classList.remove("validation-error"));

$("start").addEventListener("click", async () => {
  const tabError = validateActiveTabs();
  if (tabError) return $("status").textContent = tabError;
  const turnError = validateMaxTurns();
  if (turnError) return $("status").textContent = turnError;

  const initialPrompt = $("prompt").value.trim();
  if (!initialPrompt) return $("status").textContent = "Enter a primary objective or initial prompt.";

  $("status").textContent = `Starting ${SIDES.length}-AI session…`;
  try {
    const jobBindings = {};
    for (const side of SIDES) jobBindings[`job${side}`] = $(`job${side}`).value.trim();
    const res = await chrome.runtime.sendMessage({
      type: "AI_BRIDGE_START",
      ...selectedBindings(),
      ...jobBindings,
      agentCount: SIDES.length,
      startSide: $("startSide").value,
      workMode: selectedWorkMode(),
      teamRules: $("teamRules").value.trim(),
      initialPrompt,
      sourceFiles: selectedSourceFiles.map(file => ({ path: file.path, size: file.size, content: file.content })),
      freshChats: $("freshOnStart").checked,
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

$("applyTeamRules").addEventListener("click", async () => {
  const rules = $("teamRules").value.trim();
  if (rules.length > 12000) {
    $("status").textContent = "Team rules are limited to 12,000 characters.";
    return;
  }
  try {
    const res = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_UPDATE_RULES", rules });
    if (!res?.ok) throw new Error(res?.error || "Could not update team rules");
    $("status").textContent = rules ? "Team rules applied to all active AI roles." : "Team rules cleared.";
    await refreshState();
  } catch (err) {
    $("status").textContent = `Team rules update failed: ${err.message}`;
  }
});

for (const side of ALL_SIDES) {
  $(`forceFrom${side}`).addEventListener("click", () => {
    if (!SIDES.includes(side)) return;
    manualRelaySource = side;
    updateManualRelayUI();
    if (latestState) updateControls(latestState);
  });
  $(`forceTo${side}`).addEventListener("change", () => {
    if (latestState) updateControls(latestState);
  });
}

$("forceRelayBtn").addEventListener("click", async () => {
  const targetSides = selectedManualRelayTargets();
  if (!targetSides.length) return;
  $("manualRelayStatus").textContent = `Reading AI ${manualRelaySource}'s last visible reply…`;
  try {
    const res = await chrome.runtime.sendMessage({
      type: "AI_BRIDGE_MANUAL_RELAY",
      sourceSide: manualRelaySource,
      targetSides
    });
    if (!res?.ok) throw new Error(res?.error || "Manual relay failed");
    $("manualRelayStatus").textContent = `Recovered AI ${manualRelaySource} and sent it to ${res.targetSides.map(side => "AI " + side).join(", ")}.`;
    await refreshState();
  } catch (err) {
    $("manualRelayStatus").textContent = `Manual relay failed: ${err.message}`;
  }
});

$("pause").addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_PAUSE" });
  if (!res?.ok) $("status").textContent = `Pause failed: ${res?.error || "Unknown error"}`;
  await refreshState();
});

$("resume").addEventListener("click", async () => {
  const tabError = validateActiveTabs();
  if (tabError) return $("status").textContent = `${tabError}\nTo resume, bind every active AI role to an open supported tab.`;

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
for (const side of ALL_SIDES) $(`resend${side}`).addEventListener("click", () => resend(side));

$("sendHumanModal").addEventListener("click", async () => {
  const text = $("humanModalResponse").value.trim();
  if (!text) {
    $("humanModalResponse").focus();
    return;
  }

  $("sendHumanModal").disabled = true;
  $("sendHumanModal").textContent = "Sending…";
  try {
    const res = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_HUMAN_REPLY", text });
    if (!res?.ok) throw new Error(res?.error || "Could not send human response");
    $("humanModalResponse").value = "";
  } catch (err) {
    $("status").textContent = `Human response failed: ${err.message}`;
  } finally {
    $("sendHumanModal").textContent = "Send response & continue";
    await refreshState();
  }
});

$("humanModalResponse").addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    $("sendHumanModal").click();
  }
});

async function suppressHumanRequest(stop) {
  const button = stop ? $("stopHumanModal") : $("suppressHumanModal");
  const other = stop ? $("suppressHumanModal") : $("stopHumanModal");
  const oldLabel = button.textContent;
  $("sendHumanModal").disabled = true;
  button.disabled = true;
  other.disabled = true;
  button.textContent = stop ? "Stopping…" : "Suppressing…";

  try {
    const res = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_HUMAN_SUPPRESS", stop: Boolean(stop) });
    if (!res?.ok) throw new Error(res?.error || "Could not suppress human request");
    $("humanModalResponse").value = "";
    $("status").textContent = stop
      ? "Human request suppressed — session stopped. You can start fresh AI chats now."
      : "Human request suppressed — session paused. Resume later or Stop to start a new session.";
  } catch (err) {
    $("status").textContent = `Suppress failed: ${err.message}`;
  } finally {
    button.textContent = oldLabel;
    await refreshState();
  }
}

$("suppressHumanModal").addEventListener("click", () => suppressHumanRequest(false));
$("stopHumanModal").addEventListener("click", () => suppressHumanRequest(true));

$("interjectNow").addEventListener("click", () => {
  $("interjectText").scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => $("interjectText").focus(), 180);
});

$("sendInterject").addEventListener("click", async () => {
  const text = $("interjectText").value.trim();
  if (!text) return $("status").textContent = "Type your interjection first.";
  $("sendInterject").disabled = true;
  $("sendInterject").textContent = "Adding…";
  try {
    const res = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_INTERJECT", text });
    if (!res?.ok) throw new Error(res?.error || "Could not add interjection");
    $("interjectText").value = "";
    const mainName = res.mainLabel || (res.mainSide ? `AI ${res.mainSide}` : "Main AI");
    $("status").textContent = `Interjection queued for ${mainName}. It will be delivered with that Main AI's next group turn.`;
  } catch (err) {
    $("status").textContent = `Interjection failed: ${err.message}`;
  } finally {
    $("sendInterject").textContent = "Queue for Main AI";
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

if ($("clearRelayArtifacts")) $("clearRelayArtifacts").addEventListener("click", async () => {
  if (latestState?.sessionActive) {
    $("status").textContent = "Stop the active Bridge session before clearing the persistent Vault.";
    return;
  }
  if (!confirm("Clear every file currently stored in the AI Bridge Vault?")) return;
  const res = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_CLEAR_ARTIFACTS" });
  if (!res?.ok) $("status").textContent = `Clear Vault failed: ${res?.error || "Unknown error"}`;
  else $("status").textContent = "Persistent Vault cleared.";
  await refreshState();
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

Promise.all([loadTheme(), loadAgentCountPreference()])
  .then(() => loadTabs({ preserve: false }))
  .then(refreshState);
setInterval(refreshState, 750);
setInterval(() => updateRoundTimers(latestState), 100);
