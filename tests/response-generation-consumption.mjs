import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hardening = fs.readFileSync(path.join(root, "coordinator-generation-hardening.js"), "utf8");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

assert.match(background, /const task = \(\) => handleCompletedResponse\(side, text,/);
assert.match(background, /responseCommitQueue = responseCommitQueue\.catch\(\(\) => \{\}\)\.then\(task\)/);
assert.match(wrapper, /rechecksGenerationAtSerializedCommit !== true/);
assert.match(wrapper, /consumesAcceptedGenerationBeforeCommit/);
assert.match(wrapper, /durablyPersistsConsumedGenerationBeforeCommit/);
assert.match(wrapper, /preventsRestartGenerationResurrection/);

const calls = [];
const persisted = [];
let behavior = "rearm";
const sandbox = {
  console,
  Date,
  String,
  Boolean,
  Object,
  state: {
    generationIdBySide: { A: "generation-1" },
    checkpointPending: false,
    checkpointRequestId: null
  },
  appendLog() {},
  generationMatches(expectedId, incomingId) {
    const expected = String(expectedId || "");
    if (!expected) return true;
    return String(incomingId || "") === expected;
  },
  async saveState() {
    persisted.push(JSON.parse(JSON.stringify(sandbox.state)));
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
vm.runInContext(hardening, sandbox, { filename: "coordinator-generation-hardening.js" });

const contract = sandbox.__AI_BRIDGE_GENERATION_SECURITY__;
assert.equal(contract.version, 3);
assert.equal(contract.failClosedWhenUnarmed, true);
assert.equal(contract.rechecksGenerationAtSerializedCommit, true);
assert.equal(contract.consumesAcceptedGenerationBeforeCommit, true);
assert.equal(contract.durablyPersistsConsumedGenerationBeforeCommit, true);
assert.equal(contract.preservesNewerGenerationArmedByCommit, true);
assert.equal(contract.preventsSequentialReplayWindow, true);
assert.equal(contract.preventsRestartGenerationResurrection, true);

const first = await sandbox.handleCompletedResponse("A", "first response", { generationId: "generation-1" });
assert.equal(first.ok, true);
assert.equal(calls.length, 1);
assert.equal(calls[0].armedDuringCommit, null, "accepted generation must be consumed before base commit logic runs");
assert.equal(calls[0].persistedBeforeCommit, null, "consumed generation must be durable before base commit logic runs");
assert.equal(persisted.length, 1);
assert.equal(persisted[0].generationIdBySide.A, null);
assert.equal(sandbox.state.generationIdBySide.A, "generation-2", "a newer generation armed during commit must survive");

const replay = await sandbox.handleCompletedResponse("A", "late mutation", { generationId: "generation-1" });
assert.equal(replay.ok, false);
assert.equal(replay.ignored, true);
assert.equal(replay.staleGeneration, true);
assert.equal(calls.length, 1);
assert.equal(persisted.length, 1, "stale replay must not write storage");
assert.equal(sandbox.state.generationIdBySide.A, "generation-2");

behavior = "no-rearm";
sandbox.state.generationIdBySide.A = "generation-3";
const second = await sandbox.handleCompletedResponse("A", "second response", { generationId: "generation-3" });
assert.equal(second.ok, true);
assert.equal(calls.at(-1).armedDuringCommit, null);
assert.equal(calls.at(-1).persistedBeforeCommit, null);
assert.equal(persisted.at(-1).generationIdBySide.A, null);
assert.equal(sandbox.state.generationIdBySide.A, null);
const secondReplay = await sandbox.handleCompletedResponse("A", "second response changed", { generationId: "generation-3" });
assert.equal(secondReplay.staleGeneration, true);
assert.equal(calls.length, 2);

behavior = "checkpoint";
sandbox.state.generationIdBySide.A = "checkpoint-generation";
sandbox.state.checkpointPending = true;
sandbox.state.checkpointRequestId = "checkpoint-generation";
const checkpoint = await sandbox.handleCompletedResponse("A", "checkpoint", { generationId: "checkpoint-generation" });
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
  Object
};
matcherOnly.globalThis = matcherOnly;
vm.createContext(matcherOnly);
vm.runInContext('function generationMatches(expectedId, incomingId) { const expected = String(expectedId || ""); if (!expected) return true; return String(incomingId || "") === expected; }', matcherOnly);
vm.runInContext(hardening, matcherOnly, { filename: "coordinator-generation-hardening.js" });
assert.equal(matcherOnly.generationMatches("", "old"), false);
assert.equal(matcherOnly.generationMatches("x", "x"), true);
assert.equal(matcherOnly.__AI_BRIDGE_GENERATION_SECURITY__.rechecksGenerationAtSerializedCommit, false);
assert.equal(matcherOnly.__AI_BRIDGE_GENERATION_SECURITY__.durablyPersistsConsumedGenerationBeforeCommit, false);

console.log("response-generation-consumption: durable restart-safe ok");
