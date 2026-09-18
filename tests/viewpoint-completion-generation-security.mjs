import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const generationHardening = fs.readFileSync(path.join(root, "coordinator-generation-hardening.js"), "utf8");
const viewpointRuntime = fs.readFileSync(path.join(root, "viewpoint-runtime.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

// Slice 7 must disarm both the transient viewpoint identity and generation arm
// after final prompt-dispatch failure. Completion safety depends on this state
// becoming unarmed before any delayed provider response can arrive.
assert.match(viewpointRuntime, /clearsTransientIdentityOnDispatchFailure:\s*true/);
assert.match(wrapper, /__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__\?\.clearsTransientIdentityOnDispatchFailure\s*!==\s*true/);

// The generation hardening layer must reject both an empty expected generation
// and a mismatched generation. The legacy core matcher used to accept any
// response while unarmed; this overlay intentionally removes that behavior.
assert.match(generationHardening, /Boolean\(expected\s*&&\s*incoming\s*&&\s*incoming\s*===\s*expected\)/);
assert.match(generationHardening, /failClosedWhenUnarmed:\s*true/);

const sandbox = vm.createContext({
  String,
  Boolean,
  Object,
  globalThis: null,
  __AI_BRIDGE_EXECUTION_KEY_ADAPTER_V1__: {
    version: 1,
    read() { return undefined; },
    write(_state, _mapName, _agentRef, value) { return value; }
  },
  generationMatches(expectedId, incomingId) {
    const expected = String(expectedId || "");
    if (!expected) return true;
    return String(incomingId || "") === expected;
  }
});
sandbox.globalThis = sandbox;
vm.runInContext(generationHardening, sandbox, { filename: "coordinator-generation-hardening.js" });

assert.equal(sandbox.generationMatches(null, "old-generation"), false,
  "unarmed sides must reject delayed responses");
assert.equal(sandbox.generationMatches("", "old-generation"), false,
  "empty expected generation must fail closed");
assert.equal(sandbox.generationMatches("new-generation", "old-generation"), false,
  "superseded generation must be rejected");
assert.equal(sandbox.generationMatches("new-generation", "new-generation"), true,
  "the currently armed generation must still be accepted");
assert.equal(sandbox.generationMatches("new-generation", ""), false,
  "provider responses without a generation id must not bypass the arm");

// Verify the real response ingress rejects stale generations before scheduling
// handleCompletedResponse. That ordering is crucial because viewpoint-runtime
// stamps provenance inside recordTranscript during the completion commit path.
const staleGate = "if (!generationMatches(state.generationIdBySide?.[side], incomingGenerationId))";
const commitSchedule = "const task = () => handleCompletedResponse(side, text";
const staleGateIndex = background.indexOf(staleGate);
const commitScheduleIndex = background.indexOf(commitSchedule);
assert.ok(staleGateIndex >= 0, "response ingress generation gate missing");
assert.ok(commitScheduleIndex >= 0, "response commit scheduling path missing");
assert.ok(staleGateIndex < commitScheduleIndex,
  "generation mismatch must be rejected before completion/provenance commit is queued");

// Model the exact security composition at the ingress boundary: after Slice 7
// clears generationIdBySide, a delayed response cannot reach the commit path;
// after a replacement prompt arms a new id, a response from the old generation
// still cannot reach it. This deliberately counts commit attempts rather than
// reproducing coordinator business logic.
let commits = 0;
function ingress(expectedGeneration, incomingGeneration) {
  if (!sandbox.generationMatches(expectedGeneration, incomingGeneration)) {
    return { ok: false, ignored: true, stale: true };
  }
  commits += 1;
  return { ok: true };
}

assert.deepEqual(ingress(null, "failed-send-generation"), { ok: false, ignored: true, stale: true });
assert.equal(commits, 0, "delayed response after failed dispatch must not commit");
assert.deepEqual(ingress("replacement-generation", "failed-send-generation"), { ok: false, ignored: true, stale: true });
assert.equal(commits, 0, "superseded response must not commit");
assert.deepEqual(ingress("replacement-generation", "replacement-generation"), { ok: true });
assert.equal(commits, 1, "current generation should still reach completion commit");

console.log("viewpoint-completion-generation-security: ok");
