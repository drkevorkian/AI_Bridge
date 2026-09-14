const SIDES = ["A", "B", "C"];
const STATE_VERSION = 3;

const DEFAULT_STATE = {
  stateVersion: STATE_VERSION,
  sessionActive: false,
  running: false,
  paused: false,
  pauseReason: "",

  tabA: null,
  tabB: null,
  tabC: null,
  labelA: "AI A",
  labelB: "AI B",
  labelC: "AI C",
  jobA: "",
  jobB: "",
  jobC: "",

  currentSide: null,
  startSide: "A",
  turn: 0,
  maxTurns: 30,
  delayMs: 1500,
  initialPrompt: "",

  lastResponseBySide: {},
  lastSentBySide: {},
  lastDeliveredSeqBySide: { A: 0, B: 0, C: 0 },

  awaitingHuman: false,
  pendingHuman: null,

  transcript: [],
  nextSeq: 1,
  log: []
};

let state = { ...DEFAULT_STATE };
let stateReady = loadState();

function cloneDefaultState() {
  return {
    ...DEFAULT_STATE,
    lastResponseBySide: {},
    lastSentBySide: {},
    lastDeliveredSeqBySide: { A: 0, B: 0, C: 0 },
    transcript: [],
    log: []
  };
}

async function saveState() {
  await chrome.storage.local.set({ bridgeState: state });
}

async function tabExists(tabId) {
  if (!Number.isInteger(Number(tabId))) return false;
  try {
    await chrome.tabs.get(Number(tabId));
    return true;
  } catch (_) {
    return false;
  }
}

async function validateSavedBindings() {
  if (!state.sessionActive) return;

  const missing = [];
  for (const side of SIDES) {
    const tabId = tabForSide(side);
    if (!(await tabExists(tabId))) missing.push(side);
  }

  if (missing.length) {
    state.running = false;
    state.paused = true;
    state.pauseReason = `Reconnect AI ${missing.join(", AI ")} and press Resume.`;
    for (const side of missing) state[`tab${side}`] = null;
    await saveState();
  }
}

async function loadState() {
  const { bridgeState } = await chrome.storage.local.get("bridgeState");

  if (bridgeState?.stateVersion === STATE_VERSION) {
    state = {
      ...cloneDefaultState(),
      ...bridgeState,
      lastResponseBySide: bridgeState.lastResponseBySide || {},
      lastSentBySide: bridgeState.lastSentBySide || {},
      lastDeliveredSeqBySide: {
        A: 0,
        B: 0,
        C: 0,
        ...(bridgeState.lastDeliveredSeqBySide || {})
      },
      transcript: Array.isArray(bridgeState.transcript) ? bridgeState.transcript : [],
      log: Array.isArray(bridgeState.log) ? bridgeState.log : []
    };
  } else {
    // v1.2 and older did not have a third participant or resumable state.
    // Preserve a few useful settings, but start with a clean v1.3 session.
    state = cloneDefaultState();
    if (bridgeState) {
      state.maxTurns = Number(bridgeState.maxTurns) || state.maxTurns;
      state.delayMs = Number(bridgeState.delayMs) || state.delayMs;
    }
    await saveState();
  }

  await validateSavedBindings();

  // Manifest V3 service workers are disposable. When Chrome wakes this worker
  // back up, proactively reconnect all three page listeners so a saved running
  // session can continue without the popup having to be opened first.
  if (state.sessionActive && state.running) {
    try {
      await Promise.all(SIDES.map(side => ensureTabListener(tabForSide(side))));
    } catch (err) {
      state.running = false;
      state.paused = true;
      state.pauseReason = `Automatic reconnect failed: ${err.message}. Rebind the three tabs and press Resume.`;
      await saveState();
    }
  }

  if (state.awaitingHuman && state.pendingHuman) {
    await showHumanAttention(state.pendingHuman.requestingSide, state.pendingHuman.prompt);
  } else {
    await clearAttention();
  }
}

function tabForSide(side) {
  return state[`tab${side}`] ?? null;
}

function sideForTab(tabId) {
  return SIDES.find(side => Number(tabForSide(side)) === Number(tabId)) || null;
}

function labelForSide(side) {
  return state[`label${side}`] || `AI ${side}`;
}

function jobForSide(side) {
  return String(state[`job${side}`] || "").trim() || "General collaborator: help solve the objective while respecting the other assigned roles.";
}

function nextSide(side) {
  const idx = SIDES.indexOf(side);
  return idx < 0 ? "A" : SIDES[(idx + 1) % SIDES.length];
}

function latestSeq() {
  return Math.max(0, Number(state.nextSeq || 1) - 1);
}

function humanProtocolText() {
  return [
    "HUMAN-INPUT PROTOCOL:",
    "If you genuinely need information, a decision, clarification, or permission from the human controller before you can continue, end your response with exactly:",
    "[[HUMAN_INPUT: your question to the human]]",
    "Use that marker only when the human must answer. Do not use it merely because you are asking another AI a question."
  ].join("\n");
}

function teamContext(side) {
  const roster = SIDES.map(s => `- AI ${s} — ${labelForSide(s)} — JOB: ${jobForSide(s)}`).join("\n");
  return [
    `You are AI ${side} (${labelForSide(side)}) in a three-AI team coordinated by AI Bridge.`,
    "",
    "YOUR ASSIGNED JOB:",
    jobForSide(side),
    "",
    "TEAM ROSTER:",
    roster,
    "",
    "WORKING RULES:",
    "- Do your assigned job first. Do not silently take over another agent's job unless it is necessary to unblock the team.",
    "- Build on the shared updates below and explicitly challenge errors that affect your job.",
    "- Treat AI A, AI B, and AI C as collaborators on the same objective.",
    "- Do not add browser-extension meta-commentary unless it is necessary to diagnose the relay itself.",
    humanProtocolText()
  ].join("\n");
}

function formatEntry(entry) {
  if (entry.type === "response") {
    return `[${entry.seq}] AI ${entry.side} (${entry.label || labelForSide(entry.side)}):\n${entry.text}`;
  }
  if (entry.type === "human") {
    return `[${entry.seq}] HUMAN CONTROLLER:\n${entry.text}`;
  }
  return `[${entry.seq}] ${String(entry.type || "update").toUpperCase()}:\n${entry.text || ""}`;
}

function boundedTranscript(entries, maxChars = 48000) {
  const parts = [];
  let used = 0;

  for (let i = entries.length - 1; i >= 0; i--) {
    const part = formatEntry(entries[i]);
    if (parts.length && used + part.length > maxChars) break;
    parts.unshift(part);
    used += part.length;
  }

  const omitted = parts.length < entries.length;
  return `${omitted ? "[Earlier transcript entries omitted to keep the recovery message bounded.]\n\n" : ""}${parts.join("\n\n")}`.trim();
}

function recordTranscript(type, { side = null, text = "", ...extra } = {}) {
  const entry = {
    seq: state.nextSeq++,
    time: Date.now(),
    type,
    side,
    label: side ? labelForSide(side) : undefined,
    text: String(text || ""),
    ...extra
  };
  state.transcript.push(entry);
  return entry;
}

function initialMessage(side) {
  return [
    teamContext(side),
    "",
    "PRIMARY OBJECTIVE FROM THE HUMAN CONTROLLER:",
    state.initialPrompt,
    "",
    "You are the first speaker. Begin the work from your assigned job's perspective, and produce something useful for the next two agents to build on."
  ].join("\n");
}

function normalTurnMessage(side) {
  const delivered = Number(state.lastDeliveredSeqBySide[side] || 0);
  const unseen = state.transcript.filter(entry => entry.seq > delivered && !(entry.type === "response" && entry.side === side));
  const context = boundedTranscript(unseen);
  const deliveredSeq = latestSeq();

  return {
    deliveredSeq,
    text: [
      teamContext(side),
      "",
      "PRIMARY OBJECTIVE FROM THE HUMAN CONTROLLER:",
      state.initialPrompt,
      "",
      "SHARED UPDATES SINCE YOUR LAST HANDOFF:",
      context || "No new shared updates were recorded.",
      "",
      "Continue from where you left off. Perform your assigned job on the updated shared state, then hand useful conclusions to the team in your response."
    ].join("\n")
  };
}

function recoveryMessage(side) {
  const recent = boundedTranscript(state.transcript);
  return {
    deliveredSeq: latestSeq(),
    text: [
      teamContext(side),
      "",
      "SESSION RECOVERY / RESUME:",
      "AI Bridge is restoring an existing session. Pick up the work rather than starting the project over.",
      "",
      "PRIMARY OBJECTIVE FROM THE HUMAN CONTROLLER:",
      state.initialPrompt,
      "",
      "RECENT SHARED TRANSCRIPT:",
      recent || "No completed AI responses have been recorded yet.",
      "",
      "Resume the current task from your assigned job's perspective. Reconstruct any necessary working state from the objective and transcript, then continue."
    ].join("\n")
  };
}

function humanReplyMessage(side, question, answer) {
  return {
    deliveredSeq: latestSeq(),
    text: [
      teamContext(side),
      "",
      "The human controller answered your request for input.",
      "",
      `Your question/request was: ${question}`,
      "",
      "HUMAN RESPONSE:",
      answer,
      "",
      "Continue the work you were doing before the interruption. Do not restart from scratch. If you still require human input, use the HUMAN_INPUT protocol again."
    ].join("\n")
  };
}

function extractHumanRequest(text) {
  const marker = /\[\[HUMAN_INPUT\s*:\s*([\s\S]*?)\]\]/i.exec(text);
  if (marker?.[1]?.trim()) return marker[1].trim();

  const fallback = /(?:human input (?:needed|required)|ask the human|need (?:the )?human(?:'s)? input)\s*[:\-]?\s*([\s\S]{3,500})$/i.exec(text.trim());
  return fallback?.[1]?.trim() || null;
}

async function ensureTabListener(tabId) {
  if (!Number.isInteger(Number(tabId))) throw new Error("No tab is assigned to this AI.");
  tabId = Number(tabId);

  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: "AI_BRIDGE_PING" });
    if (pong?.ok) return pong;
  } catch (_) {}

  const tab = await chrome.tabs.get(tabId);
  const url = tab?.url || "";
  const supported = [
    /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//,
    /^https:\/\/grok\.com\//,
    /^https:\/\/claude\.ai\//,
    /^https:\/\/gemini\.google\.com\//,
    /^https:\/\/copilot\.microsoft\.com\//
  ].some(re => re.test(url));

  if (!supported) throw new Error(`Selected tab is not on a supported AI site: ${url || "unknown URL"}`);

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch (err) {
    throw new Error(`Could not connect to the page (${err.message}). Try refreshing that AI tab once.`);
  }

  await new Promise(resolve => setTimeout(resolve, 150));

  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: "AI_BRIDGE_PING" });
    if (pong?.ok) return pong;
  } catch (_) {}

  throw new Error("The page listener could not be established after reinjection.");
}

async function sendToSide(side, text, { record = true, deliveredSeq = null } = {}) {
  const tabId = tabForSide(side);
  await ensureTabListener(tabId);

  let result;
  try {
    result = await chrome.tabs.sendMessage(Number(tabId), { type: "AI_BRIDGE_SEND", text });
  } catch (_) {
    await ensureTabListener(tabId);
    result = await chrome.tabs.sendMessage(Number(tabId), { type: "AI_BRIDGE_SEND", text });
  }

  if (!result?.ok) throw new Error(result?.error || "The page did not accept the message.");

  if (record) {
    // A fresh prompt can legitimately produce the exact same wording as this
    // agent's previous turn. Clear the per-agent response guard only after the
    // new prompt was accepted by the page.
    delete state.lastResponseBySide[side];
    state.lastSentBySide[side] = text;
    if (Number.isFinite(Number(deliveredSeq))) state.lastDeliveredSeqBySide[side] = Number(deliveredSeq);
    state.log.push({ time: Date.now(), type: "sent", side, text });
    await saveState();
  }
}

async function clearAttention() {
  try {
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setTitle({ title: "AI Bridge" });
  } catch (_) {}
}

async function showHumanAttention(requestingSide, prompt) {
  const label = labelForSide(requestingSide);
  try {
    await chrome.action.setBadgeBackgroundColor({ color: "#d97706" });
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setTitle({ title: `AI Bridge — ${label} needs human input` });
  } catch (_) {}

  try {
    await chrome.notifications.create("ai-bridge-human-input", {
      type: "basic",
      iconUrl: "icon128.png",
      title: `${label} needs your input`,
      message: String(prompt).slice(0, 240),
      priority: 2
    });
  } catch (_) {}
}

async function pauseBridge(reason = "Paused by user") {
  if (!state.sessionActive) return;
  state.running = false;
  state.paused = true;
  state.pauseReason = reason;
  state.log.push({ time: Date.now(), type: "system", text: reason });
  await saveState();
}

async function endBridge(reason = "Stopped") {
  state.sessionActive = false;
  state.running = false;
  state.paused = false;
  state.pauseReason = "";
  state.currentSide = null;
  state.awaitingHuman = false;
  state.pendingHuman = null;
  state.log.push({ time: Date.now(), type: "system", text: reason });
  await clearAttention();
  await saveState();
}

async function bindTabsFromMessage(msg) {
  const tabIds = SIDES.map(side => Number(msg[`tab${side}`]));
  if (tabIds.some(id => !Number.isInteger(id) || id <= 0)) throw new Error("Choose three supported AI tabs.");
  if (new Set(tabIds).size !== 3) throw new Error("AI A, AI B, and AI C must use three different tabs.");

  await Promise.all(tabIds.map(ensureTabListener));

  for (const side of SIDES) {
    state[`tab${side}`] = Number(msg[`tab${side}`]);
    if (msg[`label${side}`]) state[`label${side}`] = String(msg[`label${side}`]);
  }
}

async function handleCompletedResponse(side, text, { relay = true } = {}) {
  if (!side || side !== state.currentSide) return { ok: false, ignored: true };
  if (!text) return { ok: false, ignored: true };
  if (state.lastResponseBySide[side] === text) return { ok: false, duplicate: true };

  state.lastResponseBySide[side] = text;
  const entry = recordTranscript("response", { side, text });
  state.turn += 1;
  state.log.push({ time: Date.now(), type: "response", side, seq: entry.seq, text });
  await saveState();

  const humanPrompt = extractHumanRequest(text);
  if (humanPrompt) {
    state.awaitingHuman = true;
    state.pendingHuman = {
      requestingSide: side,
      requestingLabel: labelForSide(side),
      prompt: humanPrompt,
      fullResponse: text,
      time: Date.now()
    };
    state.currentSide = side;
    await saveState();
    await showHumanAttention(side, humanPrompt);
    return { ok: true, awaitingHuman: true };
  }

  if (state.turn >= state.maxTurns) {
    await endBridge(`Reached maximum of ${state.maxTurns} AI turns`);
    return { ok: true, finished: true };
  }

  const targetSide = nextSide(side);
  state.currentSide = targetSide;
  await saveState();

  if (!relay || !state.running) {
    state.paused = true;
    state.pauseReason = `Paused after AI ${side} completed. Next: AI ${targetSide}.`;
    await saveState();
    return { ok: true, paused: true };
  }

  await new Promise(resolve => setTimeout(resolve, state.delayMs));
  if (!state.sessionActive || !state.running || state.awaitingHuman) return { ok: false, stopped: true };

  const outgoing = normalTurnMessage(targetSide);
  try {
    await sendToSide(targetSide, outgoing.text, { deliveredSeq: outgoing.deliveredSeq });
    return { ok: true };
  } catch (err) {
    await pauseBridge(`Could not send to AI ${targetSide}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    await stateReady;

    if (msg.type === "AI_BRIDGE_GET_STATE") {
      sendResponse({ ok: true, state });
      return;
    }

    if (msg.type === "AI_BRIDGE_START") {
      if (state.sessionActive) throw new Error("A saved session already exists. Resume it or Stop it before starting a new one.");

      const fresh = cloneDefaultState();
      fresh.sessionActive = true;
      fresh.running = false;
      fresh.paused = false;
      fresh.startSide = SIDES.includes(msg.startSide) ? msg.startSide : "A";
      fresh.currentSide = fresh.startSide;
      fresh.maxTurns = Math.max(1, Math.min(300, Number(msg.maxTurns) || 30));
      const requestedDelay = Number(msg.delayMs);
      fresh.delayMs = Math.max(0, Math.min(30000, Number.isFinite(requestedDelay) ? requestedDelay : 1500));
      fresh.initialPrompt = String(msg.initialPrompt || "").trim();
      if (!fresh.initialPrompt) throw new Error("Enter an initial objective or prompt.");

      for (const side of SIDES) {
        fresh[`tab${side}`] = Number(msg[`tab${side}`]);
        fresh[`label${side}`] = String(msg[`label${side}`] || `AI ${side}`);
        fresh[`job${side}`] = String(msg[`job${side}`] || "").trim();
      }

      state = fresh;
      await bindTabsFromMessage(msg);
      state.running = true;
      await clearAttention();
      await saveState();

      const text = initialMessage(state.startSide);
      await sendToSide(state.startSide, text, { deliveredSeq: latestSeq() });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "AI_BRIDGE_PAUSE") {
      if (!state.sessionActive) throw new Error("There is no active session to pause.");
      await pauseBridge("Paused by user");
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "AI_BRIDGE_RESUME") {
      if (!state.sessionActive) throw new Error("There is no saved session to resume.");
      if (state.awaitingHuman) throw new Error("Answer the pending human-input request before resuming.");

      await bindTabsFromMessage(msg);
      state.running = true;
      state.paused = false;
      state.pauseReason = "";
      state.currentSide = SIDES.includes(state.currentSide) ? state.currentSide : state.startSide;
      delete state.lastResponseBySide[state.currentSide];
      await clearAttention();
      await saveState();

      const outgoing = recoveryMessage(state.currentSide);
      try {
        await sendToSide(state.currentSide, outgoing.text, { deliveredSeq: outgoing.deliveredSeq });
      } catch (err) {
        await pauseBridge(`Resume failed: ${err.message}`);
        throw err;
      }
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "AI_BRIDGE_STOP") {
      await endBridge("Stopped by user");
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "AI_BRIDGE_RESEND") {
      if (!state.sessionActive || !state.running) throw new Error("Start or resume the bridge session first.");
      if (state.awaitingHuman) throw new Error("Answer the pending human-input request before resending.");
      const side = String(msg.side || "").toUpperCase();
      if (!SIDES.includes(side)) throw new Error("Unknown AI side.");

      const text = state.lastSentBySide[side];
      if (!text) throw new Error(`Nothing has been sent to AI ${side} yet.`);

      state.currentSide = side;
      delete state.lastResponseBySide[side];
      await saveState();
      await sendToSide(side, text, { record: false });
      state.log.push({ time: Date.now(), type: "resent", side, text });
      await saveState();
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "AI_BRIDGE_HUMAN_REPLY") {
      if (!state.sessionActive || !state.awaitingHuman || !state.pendingHuman) {
        throw new Error("There is no pending human-input request.");
      }

      const answer = String(msg.text || "").trim();
      if (!answer) throw new Error("Enter a response first.");

      const pending = state.pendingHuman;
      const requestingSide = pending.requestingSide;
      recordTranscript("human", {
        text: answer,
        question: pending.prompt,
        requestedBySide: requestingSide
      });

      state.awaitingHuman = false;
      state.pendingHuman = null;
      state.currentSide = requestingSide;
      delete state.lastResponseBySide[requestingSide];
      state.log.push({ time: Date.now(), type: "human", side: requestingSide, text: answer });
      await clearAttention();
      await saveState();

      const outgoing = humanReplyMessage(requestingSide, pending.prompt, answer);
      await sendToSide(requestingSide, outgoing.text, { deliveredSeq: outgoing.deliveredSeq });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === "AI_BRIDGE_RESPONSE") {
      if (!state.sessionActive || !sender.tab) {
        sendResponse({ ok: false, ignored: true });
        return;
      }

      if (state.awaitingHuman) {
        sendResponse({ ok: false, awaitingHuman: true });
        return;
      }

      const side = sideForTab(sender.tab.id);
      const text = String(msg.text || "").trim();

      // If the user manually paused while the current AI was still generating,
      // capture that completed work and advance the cursor, but do not relay it.
      const relay = state.running;
      const result = await handleCompletedResponse(side, text, { relay });
      sendResponse(result);
      return;
    }
  })().catch(async err => {
    console.error("AI Bridge background error", err);
    try { sendResponse({ ok: false, error: err.message }); } catch (_) {}
  });

  return true;
});

chrome.notifications.onClicked.addListener(async notificationId => {
  await stateReady;
  if (notificationId !== "ai-bridge-human-input") return;
  try {
    await chrome.notifications.clear(notificationId);
    if (state.pendingHuman?.requestingSide) {
      const tabId = tabForSide(state.pendingHuman.requestingSide);
      const tab = await chrome.tabs.get(Number(tabId));
      if (tab?.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true });
        await chrome.tabs.update(tab.id, { active: true });
      }
    }
  } catch (_) {}
});

chrome.tabs.onRemoved.addListener(async tabId => {
  await stateReady;
  if (!state.sessionActive) return;
  const side = sideForTab(tabId);
  if (!side) return;

  state[`tab${side}`] = null;
  state.running = false;
  state.paused = true;
  state.pauseReason = `AI ${side} tab was closed. Open/reselect it and press Resume.`;
  state.log.push({ time: Date.now(), type: "system", text: state.pauseReason });
  await saveState();
});
