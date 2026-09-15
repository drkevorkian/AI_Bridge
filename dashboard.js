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
const PANE_WIDTH_KEY = "aiBridgeControlPaneWidth";
const FRESH_KEY = "aiBridgeFreshOnStart";
const DEFAULT_PANE_PCT = 40;
const MIN_PANE_PCT = 24;
const MAX_PANE_PCT = 70;
const THEMES = new Set(["blizzard", "ghostwhite", "midnight", "slate", "light", "solarized", "ocean", "terminal"]);
let tabsById = new Map();
let latestState = null;
let hydrated = false;
let renderedSeq = 0;
let autoScroll = true;
let selectedSourceFiles = [];
let activeHumanModalKey = "";
const WORK_MODE_INFO = {
  relay: {
    label: "Relay",
    minTurns: 1,
    help: [
      "Timing: sequential A → B → C. One AI at a time.",
      "Peer visibility: every later AI sees accumulated shared updates before it responds, and continues the same problem.",
      "Cycle: 3 responses (A, then B, then C) make one lap.",
      "Main AI: first speaker, and the recipient of queued human interjections.",
      "Best for: investigations, debugging, and iterative design where each specialist builds on prior work."
    ].join("\n")
  },
  collaborate: {
    label: "Collaborate",
    minTurns: 1,
    help: [
      "Timing: sequential like Relay. One AI at a time.",
      "Peer visibility: every later AI sees the accumulated shared deliverable and revises that same artifact.",
      "Cycle: 3 responses make one lap of the shared document/design/code.",
      "Main AI: first speaker, and the recipient of queued human interjections.",
      "Best for: writing one final design, spec, or codebase where each specialist improves the same artifact."
    ].join("\n")
  },
  compete: {
    label: "Compete",
    minTurns: 3,
    help: [
      "Timing: A, B, and C start simultaneously.",
      "Peer visibility: they do not see each other's answers during the primary pass.",
      "Cycle: 3 independent submissions make one compete pass.",
      "Main AI: still the recipient of queued human interjections; it is not a sequential first speaker in this mode.",
      "Best for: independent solutions, avoiding anchoring, then comparing results."
    ].join("\n")
  },
  parallel: {
    label: "Parallel Independent",
    minTurns: 3,
    help: [
      "Timing: A, B, and C start simultaneously.",
      "Peer visibility: they work independently on their assigned jobs rather than solving the identical problem three times.",
      "Cycle: 3 parallel job completions make one pass.",
      "Main AI: recipient of queued human interjections; all three still start together.",
      "Best for: work that decomposes into backend / frontend / research / security tracks."
    ].join("\n")
  },
  review: {
    label: "Peer Review",
    minTurns: 6,
    help: [
      "Timing: two simultaneous phases.",
      "Peer visibility: phase 1 is independent (no peer answers). Phase 2 gives each AI the other two results and requests critique.",
      "Cycle: 6 responses (3 primary + 3 critiques) make one complete review.",
      "Main AI: recipient of queued human interjections; it is not a sequential first speaker.",
      "Best for: high-confidence validation and catching mistakes or bias."
    ].join("\n")
  },
  mesh: {
    label: "Direct Mesh",
    minTurns: 1,
    help: [
      "Timing: one AI at a time.",
      "Peer visibility: the responding AI sees accumulated shared updates, then can choose the next teammate.",
      "Cycle: 1 response per handoff. Put SEND TO: AI A|B|C (or an unambiguous label) on the final non-empty line. Without a valid target, normal next-agent routing applies.",
      "Main AI: first speaker unless a prior handoff changed the cursor, and the recipient of queued human interjections.",
      "Best for: dynamic workflows where the right next specialist depends on what was just discovered."
    ].join("\n")
  }
};

function selectedWorkMode() {
  const value = $("workMode")?.value || "relay";
  return WORK_MODE_INFO[value] ? value : "relay";
}

function updateWorkModeUI() {
  const mode = selectedWorkMode();
  const info = WORK_MODE_INFO[mode];
  if ($("workModeHelp")) $("workModeHelp").textContent = info.help;
  const batch = ["compete", "parallel", "review"].includes(mode);
  $("startSide").disabled = Boolean(latestState?.sessionActive);
  $("startSide").title = batch
    ? "All three AIs start simultaneously; this selection still defines the Main AI for queued human interjections."
    : "Choose the first speaker and Main AI for queued human interjections.";
  const maxHelp = $("maxTurns")?.parentElement?.querySelector(".field-help");
  if (maxHelp) {
    maxHelp.replaceChildren();
    const strong = document.createElement("strong");
    strong.textContent = "-1 = Infinite";
    const suffix = info.minTurns > 1 ? ` · ${info.minTurns}–10000 for this mode` : " · 1–10000 = finite";
    maxHelp.append(strong, document.createTextNode(suffix));
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

function clampPanePct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_PANE_PCT;
  return Math.min(MAX_PANE_PCT, Math.max(MIN_PANE_PCT, Math.round(n * 10) / 10));
}

function applyPaneWidth(pct) {
  const width = clampPanePct(pct);
  const shell = document.querySelector(".app-shell");
  if (shell) shell.style.setProperty("--control-pane-width", `${width}%`);
  const splitter = $("paneSplitter");
  const label = $("paneWidthLabel");
  const rounded = Math.round(width);
  if (splitter) {
    splitter.setAttribute("aria-valuenow", String(rounded));
    splitter.setAttribute("aria-valuetext", `${rounded} percent`);
    splitter.title = `Control pane ${rounded}%. Drag to resize. Double-click resets to 40%.`;
  }
  if (label) label.textContent = `${rounded}%`;
  return width;
}

async function loadPaneWidth() {
  const stored = await chrome.storage.local.get(PANE_WIDTH_KEY);
  const value = stored?.[PANE_WIDTH_KEY];
  applyPaneWidth(value == null || value === "" ? DEFAULT_PANE_PCT : value);
}

async function persistPaneWidth(pct) {
  await chrome.storage.local.set({ [PANE_WIDTH_KEY]: clampPanePct(pct) });
}

function initPaneSplitter() {
  const splitter = $("paneSplitter");
  const shell = document.querySelector(".app-shell");
  if (!splitter || !shell) return;
  let dragging = false;

  function pctFromClientX(clientX) {
    const rect = shell.getBoundingClientRect();
    if (!rect.width) return DEFAULT_PANE_PCT;
    const minPx = Math.min(280, rect.width * 0.24);
    const minRight = Math.min(320, rect.width * 0.3);
    const minPct = (minPx / rect.width) * 100;
    const maxPct = 100 - (minRight / rect.width) * 100;
    const raw = ((clientX - rect.left) / rect.width) * 100;
    if (minPct >= maxPct) return DEFAULT_PANE_PCT;
    return Math.min(maxPct, Math.max(minPct, raw));
  }

  function currentPct() {
    return parseFloat(getComputedStyle(shell).getPropertyValue("--control-pane-width")) || DEFAULT_PANE_PCT;
  }

  splitter.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    if (event.detail >= 2) {
      dragging = false;
      document.body.classList.remove("is-resizing");
      shell.classList.remove("is-resizing");
      applyPaneWidth(DEFAULT_PANE_PCT);
      persistPaneWidth(DEFAULT_PANE_PCT);
      return;
    }
    dragging = true;
    splitter.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing");
    shell.classList.add("is-resizing");
    applyPaneWidth(pctFromClientX(event.clientX));
  });

  splitter.addEventListener("pointermove", event => {
    if (!dragging) return;
    applyPaneWidth(pctFromClientX(event.clientX));
  });

  async function endDrag(event) {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("is-resizing");
    shell.classList.remove("is-resizing");
    try { splitter.releasePointerCapture(event.pointerId); } catch (_) {}
    await persistPaneWidth(currentPct());
  }

  splitter.addEventListener("pointerup", endDrag);
  splitter.addEventListener("pointercancel", endDrag);
  splitter.addEventListener("dblclick", async () => {
    applyPaneWidth(DEFAULT_PANE_PCT);
    await persistPaneWidth(DEFAULT_PANE_PCT);
  });
  splitter.addEventListener("keydown", async event => {
    const current = currentPct();
    let next = current;
    if (event.key === "ArrowLeft") next = current - 1;
    else if (event.key === "ArrowRight") next = current + 1;
    else if (event.key === "Home") next = MIN_PANE_PCT;
    else if (event.key === "End") next = MAX_PANE_PCT;
    else if (event.key === "Enter" || event.key === " ") next = DEFAULT_PANE_PCT;
    else return;
    event.preventDefault();
    await persistPaneWidth(applyPaneWidth(next));
  });
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
  const rules = Array.isArray(history?.rules) ? history.rules : [];
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

  const rulesList = $("rulesHistory");
  if (rulesList) {
    rulesList.textContent = "";
    if (!rules.length) {
      rulesList.appendChild(historyEmpty("No previous team rules yet."));
    } else {
      for (const item of rules) {
        const row = document.createElement("div");
        row.className = "history-row";

        const badge = document.createElement("div");
        badge.className = "history-badge";
        badge.textContent = "ALL";

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
        use.disabled = false;
        use.addEventListener("click", () => {
          $("teamRules").value = item.text || "";
        });

        row.append(badge, copy, use);
        rulesList.appendChild(row);
      }
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
    if (option) option.textContent = `${aiName(tab?.url)} (AI ${side}) — Main`;
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
    const node = $(`timer${side}`);
    if (!node) continue;
    const startedAt = Number(s?.roundStartedAtBySide?.[side]);
    const roundNumber = Math.max(0, Number(s?.roundNumberBySide?.[side]) || 0);
    const lastDuration = Number(s?.lastRoundDurationMsBySide?.[side]);
    const active = Boolean(s?.sessionActive && Number.isFinite(startedAt) && startedAt > 0);
    node.classList.toggle("active", active);
    node.classList.toggle("idle", !active);
    if (active) {
      node.textContent = `R${roundNumber} · ${formatRoundDuration(now - startedAt, true)}`;
      node.title = `Round ${roundNumber} active · extension timer started when the prompt was submitted`;
    } else if (roundNumber > 0 && Number.isFinite(lastDuration) && lastDuration >= 0) {
      node.textContent = `R${roundNumber} · ${formatRoundDuration(lastDuration)}`;
      node.title = `Last completed round ${roundNumber} · extension-measured prompt-to-final-response time`;
    } else {
      node.textContent = "No round yet";
      node.title = "No extension-measured round has completed yet";
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
  $("workMode").disabled = Boolean(s.sessionActive);
  if ($("teamRules")) $("teamRules").disabled = false;
  if ($("applyTeamRules")) $("applyTeamRules").disabled = false;
  if ($("cloudPull")) $("cloudPull").disabled = Boolean(s.sessionActive);
  if ($("cloudPush")) $("cloudPush").disabled = false;
  if ($("cloudConnect")) $("cloudConnect").disabled = false;
  if ($("cloudUnlink")) $("cloudUnlink").disabled = false;
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
  $("rulesHistory")?.querySelectorAll(".history-use").forEach(button => { button.disabled = false; });
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
  const mode = selectedWorkMode();
  const minTurns = WORK_MODE_INFO[mode]?.minTurns || 1;
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
  if (area !== "local") return;
  if (changes[THEME_KEY]) applyTheme(changes[THEME_KEY].newValue);
  if (Object.prototype.hasOwnProperty.call(changes, PANE_WIDTH_KEY)) {
    applyPaneWidth(changes[PANE_WIDTH_KEY].newValue ?? DEFAULT_PANE_PCT);
  }
  if (Object.prototype.hasOwnProperty.call(changes, FRESH_KEY) && $("freshOnStart")) {
    $("freshOnStart").checked = changes[FRESH_KEY].newValue !== false;
  }
});

async function openFreshChats(sides) {
  if (latestState?.sessionActive) return;
  const chosen = Array.isArray(sides) ? sides : SIDES;
  const tabError = validateThreeTabs();
  if (chosen.length === 3 && tabError) {
    $("status").textContent = tabError;
    return;
  }

  const oldLabels = new Map();
  for (const side of chosen) {
    const button = chosen.length === 1 ? $(`newChat${side}`) : null;
    if (button) { oldLabels.set(button, button.textContent); button.textContent = "Opening…"; button.disabled = true; }
  }
  if (chosen.length === 3) { oldLabels.set($("newAllChats"), $("newAllChats").textContent); $("newAllChats").textContent = "Opening…"; $("newAllChats").disabled = true; }

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
$("clearRulesHistory").addEventListener("click", () => clearHistory("rules"));
$("applyTeamRules")?.addEventListener("click", async () => {
  const button = $("applyTeamRules");
  const old = button.textContent;
  button.disabled = true;
  button.textContent = "Applying…";
  try {
    const res = await chrome.runtime.sendMessage({
      type: "AI_BRIDGE_SET_TEAM_RULES",
      teamRules: $("teamRules").value
    });
    if (!res?.ok) throw new Error(res?.error || "Could not apply team rules");
    $("status").textContent = res.live
      ? "Team rules applied. Every later A/B/C turn will receive them, regardless of job."
      : "Team rules saved. They will bind every member when you Start.";
    await refreshState();
  } catch (err) {
    $("status").textContent = `Team rules failed: ${err.message}`;
  } finally {
    button.textContent = old;
    button.disabled = false;
  }
});

for (const side of SIDES) {
  $(`tab${side}`).addEventListener("change", () => { refreshStartLabels(); if (latestState) updateControls(latestState); });
  $(`newChat${side}`).addEventListener("click", () => openFreshChats([side]));
}
$("newAllChats").addEventListener("click", () => openFreshChats(SIDES));
$("workMode").addEventListener("change", () => {
  updateWorkModeUI();
  $("maxTurns").classList.remove("validation-error");
});
$("maxTurns").addEventListener("input", () => $("maxTurns").classList.remove("validation-error"));
if ($("freshOnStart")) {
  $("freshOnStart").addEventListener("change", async () => {
    await chrome.storage.local.set({ [FRESH_KEY]: $("freshOnStart").checked });
  });
}

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
      workMode: selectedWorkMode(),
      jobA: $("jobA").value.trim(),
      jobB: $("jobB").value.trim(),
      jobC: $("jobC").value.trim(),
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

async function loadFreshOnStart() {
  const stored = await chrome.storage.local.get(FRESH_KEY);
  if (Object.prototype.hasOwnProperty.call(stored, FRESH_KEY) && $("freshOnStart")) {
    $("freshOnStart").checked = stored[FRESH_KEY] !== false;
  }
}

function currentPanePct() {
  const shell = document.querySelector(".app-shell");
  const raw = shell ? parseFloat(getComputedStyle(shell).getPropertyValue("--control-pane-width")) : DEFAULT_PANE_PCT;
  return clampPanePct(raw);
}

function showCloudNotice(text, isError = false) {
  const el = $("cloudNotice");
  if (!el) return;
  if (!text) {
    el.classList.add("hidden");
    el.textContent = "";
    el.classList.remove("error");
    return;
  }
  el.classList.remove("hidden");
  el.classList.toggle("error", Boolean(isError));
  el.textContent = text;
}

function collectCloudSettings() {
  return {
    theme: document.documentElement.dataset.theme || "blizzard",
    paneWidth: currentPanePct(),
    workMode: selectedWorkMode(),
    startSide: $("startSide")?.value || "A",
    maxTurns: Number($("maxTurns")?.value),
    delayMs: Number($("delayMs")?.value),
    freshOnStart: Boolean($("freshOnStart")?.checked),
    jobA: $("jobA")?.value || "",
    jobB: $("jobB")?.value || "",
    jobC: $("jobC")?.value || "",
    teamRules: $("teamRules")?.value || "",
    history: latestState?.history || { jobs: [], commands: [], rules: [] }
  };
}

function applyCloudSettingsToForm(settings) {
  if (!settings || typeof settings !== "object") return;
  if (settings.theme) applyTheme(settings.theme);
  if (settings.paneWidth != null) applyPaneWidth(settings.paneWidth);
  if ($("freshOnStart")) $("freshOnStart").checked = settings.freshOnStart !== false;
  if ($("workMode") && WORK_MODE_INFO[settings.workMode]) $("workMode").value = settings.workMode;
  if ($("startSide") && SIDES.includes(settings.startSide)) $("startSide").value = settings.startSide;
  if (Number.isInteger(Number(settings.maxTurns))) $("maxTurns").value = String(settings.maxTurns);
  if (Number.isFinite(Number(settings.delayMs))) $("delayMs").value = String(settings.delayMs);
  if (typeof settings.jobA === "string") $("jobA").value = settings.jobA;
  if (typeof settings.jobB === "string") $("jobB").value = settings.jobB;
  if (typeof settings.jobC === "string") $("jobC").value = settings.jobC;
  if (typeof settings.teamRules === "string") $("teamRules").value = settings.teamRules;
  if (settings.history) renderHistory(settings.history);
  updateWorkModeUI();
}

async function refreshCloudStatus() {
  const pill = $("cloudStatusPill");
  try {
    const res = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_CLOUD_STATUS" });
    if (!res?.ok) throw new Error(res?.error || "Cloud status unavailable");
    let label = "Local only";
    let state = "local";
    if (res.googleLinked) {
      label = "Google linked";
      state = "google";
    } else if (res.chromeSyncHasCopy) {
      label = "Chrome Sync copy";
      state = "sync";
    } else if (res.chromeSyncAvailable) {
      label = "Local · Sync optional";
      state = "local";
    }
    if (pill) {
      pill.textContent = label;
      pill.dataset.state = state;
    }
    if ($("cloudUnlink")) $("cloudUnlink").disabled = !res.googleLinked;
    if (!res.googleConfigured && $("cloudConnect")) {
      $("cloudConnect").title = "Needs a Google Cloud OAuth client ID in the packaged manifest, scoped only to drive.appdata. Push/Pull still work through Chrome Sync.";
    }
  } catch (err) {
    if (pill) {
      pill.textContent = "Sync unavailable";
      pill.dataset.state = "local";
    }
    showCloudNotice(err.message, true);
  }
}

async function runCloudAction(button, type, extra = {}) {
  if (!button) return;
  const old = button.textContent;
  button.disabled = true;
  button.textContent = "Working…";
  showCloudNotice();
  try {
    const res = await chrome.runtime.sendMessage({ type, ...extra });
    if (!res?.ok) throw new Error(res?.error || "Cloud action failed");
    if (res.settings) applyCloudSettingsToForm(res.settings);
    if (type === "AI_BRIDGE_CLOUD_PUSH") {
      const via = res.via || "chrome-sync";
      showCloudNotice(`Settings pushed (${via}, ${res.bytes || 0} bytes). Transcripts, Vault files, and tokens were not included.`);
    } else if (type === "AI_BRIDGE_CLOUD_PULL") {
      showCloudNotice(`Settings pulled from ${res.via || "cloud"} (newest valid copy). Transcripts and Vault files stayed local.`);
      await refreshState();
    } else if (type === "AI_BRIDGE_CLOUD_CONNECT") {
      showCloudNotice(res.googleLinked
        ? "Google account linked. Settings will use the private Drive appDataFolder plus Chrome Sync. Tokens stay in Chrome's identity cache."
        : "Google login is not configured yet.");
    } else if (type === "AI_BRIDGE_CLOUD_UNLINK") {
      showCloudNotice("Google account unlinked on this extension. Chrome Sync still works. Drive app data was not deleted.");
    }
    await refreshCloudStatus();
  } catch (err) {
    showCloudNotice(err.message, true);
    $("status").textContent = err.message;
  } finally {
    button.textContent = old;
    button.disabled = false;
    if (latestState) updateControls(latestState);
  }
}

if ($("cloudPush")) {
  $("cloudPush").addEventListener("click", () => runCloudAction($("cloudPush"), "AI_BRIDGE_CLOUD_PUSH", { settings: collectCloudSettings() }));
}
if ($("cloudPull")) {
  $("cloudPull").addEventListener("click", () => runCloudAction($("cloudPull"), "AI_BRIDGE_CLOUD_PULL"));
}
if ($("cloudConnect")) {
  $("cloudConnect").addEventListener("click", () => runCloudAction($("cloudConnect"), "AI_BRIDGE_CLOUD_CONNECT"));
}
if ($("cloudUnlink")) {
  $("cloudUnlink").addEventListener("click", () => runCloudAction($("cloudUnlink"), "AI_BRIDGE_CLOUD_UNLINK"));
}

initPaneSplitter();
Promise.all([loadTheme(), loadPaneWidth(), loadFreshOnStart(), loadTabs({ preserve: false })]).then(async () => {
  await refreshState();
  await refreshCloudStatus();
});
setInterval(refreshState, 750);
setInterval(() => updateRoundTimers(latestState), 100);
