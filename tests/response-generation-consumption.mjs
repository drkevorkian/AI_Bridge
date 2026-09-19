import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execution = fs.readFileSync(path.join(root, "execution-key-adapter.js"), "utf8");
const hardening = fs.readFileSync(path.join(root, "coordinator-generation-hardening.js"), "utf8");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

assert.match(background, /const task = \(\) => handleCompletedResponse\(side, text,/);
assert.match(background, /responseCommitQueue = responseCommitQueue\.catch\(\(\) => \{\}\)\.then\(task\)/);
assert.match(background, /state\.generationIdBySide\[side\] = generationId;[\s\S]*chrome\.tabs\.sendMessage\(Number\(tabId\), \{ type: "AI_BRIDGE_SEND", text, artifacts, generationId \}\)/);
assert.match(wrapper, /durablyArmsGenerationBeforeProviderSend !== true/);
assert.match(wrapper, /providerSendBoundaryGuarded !== true/);
assert.match(wrapper, /rechecksArmedGenerationAfterPersistence !== true/);
assert.match(wrapper, /durablyClearsFailedDispatchGeneration !== true/);
assert.match(wrapper, /rechecksGenerationAtSerializedCommit !== true/);
assert.match(wrapper, /consumesAcceptedGenerationBeforeCommit/);
assert.match(wrapper, /durablyPersistsConsumedGenerationBeforeCommit/);
assert.match(wrapper, /preventsRestartGenerationResurrection/);

const calls = [];
const persisted = [];
const providerCalls = [];
let behavior = "rearm";
const sandbox = {
  console,
  Date,
  String,
  Boolean,
  Number,
  URL,
  Object,
  Promise,
  Error,
  state: {
    tabA: 101,
    generationIdBySide: { A: "generation-1" },
    viewpointIdentityBySide: {
      A: {
        provenanceId: "chatgpt:tab:101:https://chatgpt.com/c/a",
        threadKey: "https://chatgpt.com/c/a",
        providerFamily: "chatgpt",
        boundTabId: 101
      }
    },
    checkpointPending: false,
    checkpointRequestId: null
  },
  __AI_BRIDGE_AGENT_CAPABILITIES__: {
    version: 1,
    ordinalForAgentId(id) {
      const match = /^agent-([1-9][0-9]*)$/.exec(String(id || ""));
      return match ? Number(match[1]) : null;
    },
    ordinalForLegacySide(side) {
      const value = String(side || "").toUpperCase();
      return /^[A-E]$/.test(value) ? value.charCodeAt(0) - 64 : null;
    },
    legacySideForOrdinal(ordinal) {
      const n = Number(ordinal);
      return Number.isInteger(n) && n >= 1 && n <= 5 ? String.fromCharCode(64 + n) : null;
    },
    agentIdForOrdinal(ordinal) { return `agent-${Number(ordinal)}`; },
    conversationIdentity({ side, tabId, url }) {
      try {
        const parsed = new URL(String(url || ""));
        if (parsed.protocol !== "https:" || parsed.hostname !== "chatgpt.com") return null;
        const pathName = parsed.pathname.replace(/\/+$/, "") || "/";
        const threadKey = `${parsed.protocol}//${parsed.hostname}${pathName}`;
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
  },
  tabForSide(side) {
    return sandbox.state[`tab${side}`];
  },
  appendLog() {},
  sideForTab(tabId) {
    return Number(tabId) === 101 ? "A" : null;
  },
  chrome: {
    tabs: {
      async sendMessage(tabId, message) {
        providerCalls.push({
          tabId,
          message: { ...message },
          persistedGeneration: persisted.at(-1)?.generationIdBySide?.A
        });
        return { ok: true };
      }
    }
  },
  generationMatches(expectedId, incomingId) {
    const expected = String(expectedId || "");
    if (!expected) return true;
    return String(incomingId || "") === expected;
  },
  async saveState() {
    persisted.push(JSON.parse(JSON.stringify(sandbox.state)));
  },
  async sendToSide(side, text) {
    if (text === "fail") {
      // Model the viewpoint/runtime failure cleanup that occurs before the final
      // send error propagates into generation hardening.
      sandbox.state.generationIdBySide[side] = null;
      throw new Error("provider send failed");
    }
    return { ok: true };
  },
  async handleCompletedResponse(side, text, options) {
    calls.push({
      side,
      text,
      generationId: options.generationId,
      armedDuringCommit: sandbox.state.generationIdBySide[side],
      persistedBeforeCommit: persisted.at(-1)?.generationIdBySide?.[side],
      checkpointRequestId: sandbox.state.checkpointRequestId
    });
    if (behavior === "rearm") {
      sandbox.state.generationIdBySide[side] = "generation-2";
    }
    return { ok: true, behavior };
  }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(execution, sandbox, { filename: "execution-key-adapter.js" });
vm.runInContext(hardening, sandbox, { filename: "coordinator-generation-hardening.js" });

const contract = sandbox.__AI_BRIDGE_GENERATION_SECURITY__;
assert.equal(contract.version, 5);
assert.equal(contract.failClosedWhenUnarmed, true);
assert.equal(contract.durablyArmsGenerationBeforeProviderSend, true);
assert.equal(contract.providerSendBoundaryGuarded, true);
assert.equal(contract.rechecksArmedGenerationAfterPersistence, true);
assert.equal(contract.durablyClearsFailedDispatchGeneration, true);
assert.equal(contract.rechecksGenerationAtSerializedCommit, true);
assert.equal(contract.consumesAcceptedGenerationBeforeCommit, true);
assert.equal(contract.durablyPersistsConsumedGenerationBeforeCommit, true);
assert.equal(contract.preservesNewerGenerationArmedByCommit, true);
assert.equal(contract.preventsSequentialReplayWindow, true);
assert.equal(contract.preventsRestartGenerationResurrection, true);
assert.equal(contract.requiresAutomaticResponsePageIdentity, true);
assert.equal(contract.rejectsCrossThreadSpaResponseBeforeConsumption, true);
assert.equal(contract.canonicalExecutionMapAccess, true);

// A coordinator-owned provider prompt cannot cross chrome.tabs.sendMessage until
// its currently armed generation is durable. The base sendMessage stub observes
// storage only after the guard completes.
sandbox.state.generationIdBySide.A = "generation-arm";
const persistedBeforeArm = persisted.length;
await sandbox.chrome.tabs.sendMessage(101, {
  type: "AI_BRIDGE_SEND",
  text: "prompt",
  artifacts: [],
  generationId: "generation-arm"
});
assert.equal(persisted.length, persistedBeforeArm + 1);
assert.equal(providerCalls.at(-1).persistedGeneration, "generation-arm");
assert.equal(persisted.at(-1).generationIdBySide.A, "generation-arm");

// Transport-only smoke traffic may exercise AI_BRIDGE_SEND without participating
// in coordinator routing. An unarmed synthetic generation is not a coordinator
// capability and therefore passes through without a storage mutation.
sandbox.state.generationIdBySide.A = null;
const persistedBeforeSynthetic = persisted.length;
const callsBeforeSynthetic = providerCalls.length;
await sandbox.chrome.tabs.sendMessage(999, {
  type: "AI_BRIDGE_SEND",
  text: "transport smoke",
  artifacts: [],
  generationId: "synthetic-unarmed-generation"
});
assert.equal(persisted.length, persistedBeforeSynthetic);
assert.equal(providerCalls.length, callsBeforeSynthetic + 1);

// If a generation is coordinator-armed, its provider message must target that
// side's current bound tab. A cross-side/mismatched tab fails before provider IO.
sandbox.state.generationIdBySide = { A: null, B: "generation-b" };
const callsBeforeMismatch = providerCalls.length;
await assert.rejects(
  () => sandbox.chrome.tabs.sendMessage(101, {
    type: "AI_BRIDGE_SEND",
    text: "wrong binding",
    artifacts: [],
    generationId: "generation-b"
  }),
  /does not target its current bound tab/
);
assert.equal(providerCalls.length, callsBeforeMismatch);

// Unrelated provider traffic is not intercepted by the generation persistence
// boundary and therefore causes no storage write.
sandbox.state.generationIdBySide = { A: null, B: null };
const persistedBeforePing = persisted.length;
await sandbox.chrome.tabs.sendMessage(101, { type: "AI_BRIDGE_PING" });
assert.equal(persisted.length, persistedBeforePing);

// A final send failure is already cleared in memory by viewpoint hardening; the
// outer generation wrapper must make that rollback durable before rethrowing.
sandbox.state.generationIdBySide.A = "failed-generation";
const persistedBeforeFailure = persisted.length;
await assert.rejects(() => sandbox.sendToSide("A", "fail"), /provider send failed/);
assert.equal(persisted.length, persistedBeforeFailure + 1);
assert.equal(persisted.at(-1).generationIdBySide.A, null);

sandbox.state.generationIdBySide.A = "generation-1";
const first = await sandbox.handleCompletedResponse("A", "first response", { generationId: "generation-1", pageUrl: "https://chatgpt.com/c/a" });
assert.equal(first.ok, true);
assert.equal(calls.length, 1);
assert.equal(calls[0].armedDuringCommit, null, "accepted generation must be consumed before base commit logic runs");
assert.equal(calls[0].persistedBeforeCommit, null, "consumed generation must be durable before base commit logic runs");
assert.equal(persisted.at(-1).generationIdBySide.A, null);
assert.equal(sandbox.state.generationIdBySide.A, "generation-2", "a newer generation armed during commit must survive");

const writesAfterFirstCommit = persisted.length;
const replay = await sandbox.handleCompletedResponse("A", "late mutation", { generationId: "generation-1", pageUrl: "https://chatgpt.com/c/a" });
assert.equal(replay.ok, false);
assert.equal(replay.ignored, true);
assert.equal(replay.staleGeneration, true);
assert.equal(calls.length, 1);
assert.equal(persisted.length, writesAfterFirstCommit, "stale replay must not write storage");
assert.equal(sandbox.state.generationIdBySide.A, "generation-2");

behavior = "no-rearm";
sandbox.state.generationIdBySide.A = "generation-3";
const second = await sandbox.handleCompletedResponse("A", "second response", { generationId: "generation-3", pageUrl: "https://chatgpt.com/c/a" });
assert.equal(second.ok, true);
assert.equal(calls.at(-1).armedDuringCommit, null);
assert.equal(calls.at(-1).persistedBeforeCommit, null);
assert.equal(persisted.at(-1).generationIdBySide.A, null);
assert.equal(sandbox.state.generationIdBySide.A, null);
const secondReplay = await sandbox.handleCompletedResponse("A", "second response changed", { generationId: "generation-3", pageUrl: "https://chatgpt.com/c/a" });
assert.equal(secondReplay.staleGeneration, true);
assert.equal(calls.length, 2);

behavior = "checkpoint";
sandbox.state.generationIdBySide.A = "checkpoint-generation";
sandbox.state.checkpointPending = true;
sandbox.state.checkpointRequestId = "checkpoint-generation";
const checkpoint = await sandbox.handleCompletedResponse("A", "checkpoint", { generationId: "checkpoint-generation", pageUrl: "https://chatgpt.com/c/a" });
assert.equal(checkpoint.ok, true);
assert.equal(calls.at(-1).armedDuringCommit, null);
assert.equal(calls.at(-1).persistedBeforeCommit, null);
assert.equal(calls.at(-1).checkpointRequestId, "checkpoint-generation");
assert.equal(persisted.at(-1).generationIdBySide.A, null);
assert.equal(sandbox.state.generationIdBySide.A, null);

// Simulate an MV3 worker restart immediately after durable consumption but before
// the base completion handler can save anything else. Reloaded storage must stay
// disarmed, so the old generation can never become valid again.
const restartedState = JSON.parse(JSON.stringify(persisted.at(-1)));
assert.equal(restartedState.generationIdBySide.A, null);
assert.equal(sandbox.generationMatches(restartedState.generationIdBySide.A, "checkpoint-generation"), false);

const matcherOnly = {
  globalThis: null,
  String,
  Boolean,
  Object,
  Promise,
  Error,
  __AI_BRIDGE_EXECUTION_KEY_ADAPTER_V1__: {
    version: 1,
    read() { return undefined; },
    write(_state, _mapName, _agentRef, value) { return value; }
  }
};
matcherOnly.globalThis = matcherOnly;
vm.createContext(matcherOnly);
vm.runInContext('function generationMatches(expectedId, incomingId) { const expected = String(expectedId || ""); if (!expected) return true; return String(incomingId || "") === expected; }', matcherOnly);
vm.runInContext(hardening, matcherOnly, { filename: "coordinator-generation-hardening.js" });
assert.equal(matcherOnly.generationMatches("", "old"), false);
assert.equal(matcherOnly.generationMatches("x", "x"), true);
assert.equal(matcherOnly.__AI_BRIDGE_GENERATION_SECURITY__.durablyArmsGenerationBeforeProviderSend, false);
assert.equal(matcherOnly.__AI_BRIDGE_GENERATION_SECURITY__.rechecksGenerationAtSerializedCommit, false);
assert.equal(matcherOnly.__AI_BRIDGE_GENERATION_SECURITY__.durablyPersistsConsumedGenerationBeforeCommit, false);

console.log("response-generation-consumption: durable arm/consume restart-safe ok");
