import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentPrelude = fs.readFileSync(path.join(root, "content-runtime-prelude.js"), "utf8");
const watchdog = fs.readFileSync(path.join(root, "watchdog-runtime-hardening.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

assert.match(contentPrelude, /generationStatusIncludesPageUrl: true/);
assert.match(contentPrelude, /AI_BRIDGE_GENERATION_STATUS/);
assert.match(wrapper, /version !== 3/);
assert.match(wrapper, /revokesMismatchedConversationBeforeTimeout !== true/);

const state = {
  sessionActive: true,
  running: true,
  paused: false,
  awaitingHuman: false,
  currentSide: "A",
  workMode: "relay",
  tabA: 101,
  generationIdBySide: { A: "A-123456789-deadbeef" },
  viewpointIdentityBySide: {
    A: {
      provenanceId: "chatgpt:tab:101:https://chatgpt.com/c/old",
      threadKey: "https://chatgpt.com/c/old",
      providerFamily: "chatgpt",
      boundTabId: 101
    }
  },
  roundStartedAtBySide: { A: 1000 },
  lastProgressAtBySide: { A: null },
  checkpointPending: false,
  checkpointRequestId: null,
  postCheckpointResume: null,
  phasePendingSides: [],
  phaseSentSides: [],
  lastResponseBySide: {}
};

const pauses = [];
const caps = {
  version: 1,
  conversationIdentity({ side, tabId, url }) {
    try {
      const parsed = new URL(String(url || ""));
      if (parsed.protocol !== "https:" || parsed.hostname !== "chatgpt.com") return null;
      const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
      const threadKey = `${parsed.protocol}//${parsed.hostname}${pathname}`;
      return {
        side,
        tabId,
        familyId: "chatgpt",
        threadKey,
        provenanceId: `chatgpt:tab:${tabId}:${threadKey}`
      };
    } catch (_) {
      return null;
    }
  }
};

const sandbox = {
  console,
  Date,
  Promise,
  URL,
  String,
  Number,
  Object,
  Array,
  Set,
  globalThis: null,
  state,
  SIDES: ["A", "B", "C"],
  __AI_BRIDGE_AGENT_CAPABILITIES__: caps,
  tabForSide(side) { return state[`tab${side}`]; },
  isBatchWorkMode() { return false; },
  queryGenerationStatus: async () => ({
    ok: true,
    generating: true,
    pendingSend: false,
    lastChangeAt: Date.now(),
    generationId: "A-123456789-deadbeef",
    pageUrl: "https://chatgpt.com/c/new"
  }),
  runWatchdogTick: async () => ({ checked: false }),
  clampStuckTimeoutMinutes() { return 30; },
  shouldDeclareStuck() { return false; },
  generationMatches(a, b) { return Boolean(a && b && a === b); },
  skipStalledCheckpoint: async () => ({ skipped: true }),
  recoverStuckSide: async () => ({ recovered: true }),
  completeRoundTimer(side) { state.roundStartedAtBySide[side] = null; },
  async pauseBridge(reason) {
    pauses.push(reason);
    state.running = false;
    state.paused = true;
    state.pauseReason = reason;
  },
  async saveState() {},
  enqueueCoordinatorMutation(task) { return Promise.resolve().then(task); }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(watchdog, sandbox, { filename: "watchdog-runtime-hardening.js" });

const result = await sandbox.runWatchdogTick(Date.now());
assert.equal(result.checked, true);
assert.equal(result.results[0].conversationMismatch, true);
assert.equal(result.results[0].revokedGeneration, true);
assert.equal(state.generationIdBySide.A, null);
assert.equal(Object.prototype.hasOwnProperty.call(state.viewpointIdentityBySide, "A"), false);
assert.equal(state.running, false);
assert.equal(state.paused, true);
assert.equal(pauses.length, 1);
assert.match(pauses[0], /moved to a different provider conversation/);

// Same path with query/hash remains authorized and should not pause.
state.running = true;
state.paused = false;
state.generationIdBySide.A = "A-123456789-feedbeef";
state.viewpointIdentityBySide.A = {
  provenanceId: "chatgpt:tab:101:https://chatgpt.com/c/old",
  threadKey: "https://chatgpt.com/c/old",
  providerFamily: "chatgpt",
  boundTabId: 101
};
state.roundStartedAtBySide.A = Date.now();
sandbox.queryGenerationStatus = async () => ({
  ok: true,
  generating: true,
  pendingSend: false,
  lastChangeAt: Date.now(),
  generationId: "A-123456789-feedbeef",
  pageUrl: "https://chatgpt.com/c/old?x=1#y"
});
const sameThread = await sandbox.runWatchdogTick(Date.now());
assert.equal(sameThread.results[0].progressing, true);
assert.equal(state.running, true);
assert.equal(state.generationIdBySide.A, "A-123456789-feedbeef");

console.log("watchdog-conversation-authority: SPA mismatch revoked immediately, same thread preserved");
