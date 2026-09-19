import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "client-state-privacy-hardening.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

const internalState = {
  tabA: 41,
  tabB: 52,
  currentSide: "A",
  viewpointIdentityBySide: {
    A: {
      provenanceId: "vp-secret-provenance",
      threadKey: "https://chatgpt.com/c/secret-thread",
      providerFamily: "chatgpt",
      boundTabId: 41
    }
  },
  transcript: [
    {
      seq: 1,
      type: "response",
      side: "A",
      text: "safe visible reply",
      provenanceId: "vp-secret-provenance",
      threadKey: "https://chatgpt.com/c/secret-thread",
      providerFamily: "chatgpt",
      boundTabId: 41
    },
    {
      seq: 2,
      type: "human",
      text: "visible human text"
    }
  ]
};

const context = vm.createContext({
  console, Object, Array, String, Number, Boolean, Error,
  clientStateSnapshot(options = {}) {
    const transcript = options?.omitTranscript ? [] : internalState.transcript.map(entry => ({ ...entry }));
    return {
      ...internalState,
      transcript,
      transcriptCount: internalState.transcript.length
    };
  }
});
context.globalThis = context;
vm.runInContext(src, context, { filename: "client-state-privacy-hardening.js" });

const snapshot = context.clientStateSnapshot();

// Functional dashboard tab bindings remain available. These are deliberately
// not treated as generic telemetry because the binding selectors need them.
assert.equal(snapshot.tabA, 41);
assert.equal(snapshot.tabB, 52);
assert.equal(snapshot.currentSide, "A");

// Worker-only viewpoint identity map must never cross AI_BRIDGE_GET_STATE.
assert.equal(Object.prototype.hasOwnProperty.call(snapshot, "viewpointIdentityBySide"), false);

// Transcript content remains usable, while worker-only provenance fields are
// removed from the client copy.
assert.equal(snapshot.transcript.length, 2);
assert.equal(snapshot.transcript[0].text, "safe visible reply");
assert.equal(snapshot.transcript[0].providerFamily, "chatgpt");
for (const key of ["provenanceId", "threadKey", "boundTabId"]) {
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot.transcript[0], key), false, `${key} must be redacted`);
}

// Redaction must not mutate the actual internal state used by worker-side
// provenance validation and persistence.
assert.equal(internalState.viewpointIdentityBySide.A.boundTabId, 41);
assert.equal(internalState.transcript[0].provenanceId, "vp-secret-provenance");
assert.equal(internalState.transcript[0].threadKey, "https://chatgpt.com/c/secret-thread");
assert.equal(internalState.transcript[0].boundTabId, 41);

const omitted = context.clientStateSnapshot({ omitTranscript: true });
assert.deepEqual(Array.from(omitted.transcript), []);
assert.equal(omitted.transcriptCount, 2);
assert.equal(Object.prototype.hasOwnProperty.call(omitted, "viewpointIdentityBySide"), false);

const contract = context.__AI_BRIDGE_CLIENT_STATE_PRIVACY_V1__;
assert.equal(contract.version, 1);
assert.equal(contract.redactsViewpointIdentityMap, true);
assert.equal(contract.redactsTranscriptViewpointIdentity, true);
assert.equal(contract.preservesFunctionalBindingTabIds, true);

assert.match(wrapper, /importScripts\("client-state-privacy-hardening\.js"\)/);
for (const capability of [
  "redactsViewpointIdentityMap",
  "redactsTranscriptViewpointIdentity",
  "preservesFunctionalBindingTabIds"
]) {
  assert.match(
    wrapper,
    new RegExp(`__AI_BRIDGE_CLIENT_STATE_PRIVACY_V1__\\?\\.${capability}\\s*!==\\s*true`),
    `bootstrap must pin ${capability}`
  );
}

console.log("client-state-viewpoint-privacy: ok");
