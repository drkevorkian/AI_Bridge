import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hardening = fs.readFileSync(path.join(root, "coordinator-generation-hardening.js"), "utf8");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

// The runtime listener must continue routing accepted provider replies through
// responseCommitQueue; the hardening wrapper is intentionally attached to
// handleCompletedResponse so its generation re-check executes inside that queue.
assert.match(background, /const task = \(\) => handleCompletedResponse\(side, text,/);
assert.match(background, /responseCommitQueue = responseCommitQueue\.catch\(\(\) => \{\}\)\.then\(task\)/);
assert.match(wrapper, /rechecksGenerationAtSerializedCommit\?\.*/s);
assert.match(wrapper, /consumesAcceptedGenerationBeforeCommit/);
assert.match(wrapper, /preventsSequentialReplayWindow/);

const calls = [];
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
  async handleCompletedResponse(side, text, options) {
    calls.push({
      side,
      text,
      generationId: options.generationId,
      armedDuringCommit: sandbox.state.generationIdBySide[side],
      checkpointRequestId: sandbox.state.checkpointRequestId
    });
    if (behavior === "rearm") {
      // Simulate a one-agent/sequential handler that dispatches the next turn to
      // the same side before returning from the serialized commit.
      sandbox.state.generationIdBySide[side] = "generation-2";
    }
    return { ok: true, behavior };
  }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(hardening, sandbox, { filename: "coordinator-generation-hardening.js" });

const contract = sandbox.__AI_BRIDGE_GENERATION_SECURITY__;
assert.equal(contract.version, 2);
assert.equal(contract.failClosedWhenUnarmed, true);
assert.equal(contract.rechecksGenerationAtSerializedCommit, true);
assert.equal(contract.consumesAcceptedGenerationBeforeCommit, true);
assert.equal(contract.preservesNewerGenerationArmedByCommit, true);
assert.equal(contract.preventsSequentialReplayWindow, true);

// First accepted response consumes generation-1 before the coordinator commits.
const first = await sandbox.handleCompletedResponse("A", "first response", { generationId: "generation-1" });
assert.equal(first.ok, true);
assert.equal(calls.length, 1);
assert.equal(calls[0].armedDuringCommit, null, "accepted generation must be consumed before base commit logic runs");
assert.equal(sandbox.state.generationIdBySide.A, "generation-2", "a newer generation armed during commit must survive");

// A duplicate task that passed the listener's earlier check with generation-1
// must be rejected when it eventually reaches the serialized commit boundary.
const replay = await sandbox.handleCompletedResponse("A", "late mutation", { generationId: "generation-1" });
assert.equal(replay.ok, false);
assert.equal(replay.ignored, true);
assert.equal(replay.staleGeneration, true);
assert.equal(calls.length, 1, "stale replay must not reach coordinator commit logic");
assert.equal(sandbox.state.generationIdBySide.A, "generation-2", "stale replay must not clear a newer armed generation");

// Normal no-rearm completion leaves the side unarmed, closing the sequential
// cursor-cycle window until sendToSide deliberately installs another token.
behavior = "no-rearm";
sandbox.state.generationIdBySide.A = "generation-3";
const second = await sandbox.handleCompletedResponse("A", "second response", { generationId: "generation-3" });
assert.equal(second.ok, true);
assert.equal(calls.at(-1).armedDuringCommit, null);
assert.equal(sandbox.state.generationIdBySide.A, null);
const secondReplay = await sandbox.handleCompletedResponse("A", "second response changed", { generationId: "generation-3" });
assert.equal(secondReplay.staleGeneration, true);
assert.equal(calls.length, 2);

// Checkpoint classification remains valid after consumption because the core
// checkpoint path has its dedicated checkpointRequestId copied from the send.
behavior = "checkpoint";
sandbox.state.generationIdBySide.A = "checkpoint-generation";
sandbox.state.checkpointPending = true;
sandbox.state.checkpointRequestId = "checkpoint-generation";
const checkpoint = await sandbox.handleCompletedResponse("A", "checkpoint", { generationId: "checkpoint-generation" });
assert.equal(checkpoint.ok, true);
assert.equal(calls.at(-1).armedDuringCommit, null);
assert.equal(calls.at(-1).checkpointRequestId, "checkpoint-generation");
assert.equal(sandbox.state.generationIdBySide.A, null);

// Isolated matcher-only consumers remain supported for older focused tests, but
// production bootstrap will reject this incomplete diagnostic contract.
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

console.log("response-generation-consumption: ok");
