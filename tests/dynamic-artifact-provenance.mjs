import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capabilities = fs.readFileSync(path.join(root, "agent-capabilities.js"), "utf8");
const prelude = fs.readFileSync(path.join(root, "coordinator-mutex-prelude.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

assert.match(wrapper, /__AI_BRIDGE_COORDINATOR_MUTEX__\?\.version !== 6/);
assert.match(wrapper, /artifactProvenanceSupportsDynamicSides !== true/);
assert.ok(
  wrapper.indexOf('importScripts("agent-capabilities.js")') < wrapper.indexOf('importScripts("coordinator-mutex-prelude.js")'),
  "the audited side-capability contract must load before the artifact provenance gate"
);

let registered = null;
const context = vm.createContext({
  globalThis: null,
  URL,
  chrome: {
    runtime: {
      onMessage: {
        addListener(listener) {
          registered = listener;
        }
      }
    },
    tabs: {}
  },
  state: {
    tabA: 101,
    tabB: 102,
    tabC: 103,
    tabD: 104,
    tabE: 105,
    generationIdBySide: {
      A: "A-1720000000000-aaaa1111",
      B: "B-1720000000000-bbbb2222",
      C: "C-1720000000000-cccc3333",
      D: "D-1720000000000-dddd4444",
      E: "E-1720000000000-eeee5555"
    }
  }
});
context.globalThis = context;

vm.runInContext(capabilities, context, { filename: "agent-capabilities.js" });
vm.runInContext(prelude, context, { filename: "coordinator-mutex-prelude.js" });

const mutex = context.__AI_BRIDGE_COORDINATOR_MUTEX__;
assert.equal(mutex.version, 6);
assert.equal(mutex.artifactProvenanceGate, true);
assert.equal(mutex.artifactProvenanceSupportsDynamicSides, true);
assert.deepEqual(Array.from(mutex.artifactProvenanceSides), ["A", "B", "C", "D", "E"]);

let accepted = 0;
context.chrome.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
  accepted += 1;
  sendResponse({ ok: true, accepted: true });
  return false;
});
assert.equal(typeof registered, "function", "hardened runtime listener must be installed");

function artifactMessage(side, generationId = context.state.generationIdBySide[side]) {
  const url = `https://files.example.test/${side.toLowerCase()}/artifact.txt`;
  return {
    type: "AI_BRIDGE_FETCH_ARTIFACT",
    observed: true,
    generationId,
    url,
    candidateSignature: `${url}|download-control`,
    name: `artifact-${side}.txt`,
    mime: "text/plain"
  };
}

function dispatch(message, tabId) {
  let response;
  const returnValue = registered(message, { tab: { id: tabId } }, value => {
    response = value;
  });
  return { returnValue, response };
}

for (const [side, tabId] of [["A", 101], ["D", 104], ["E", 105]]) {
  const result = dispatch(artifactMessage(side), tabId);
  assert.equal(result.response?.ok, true, `AI ${side} should pass the provenance gate from its own bound tab`);
}
assert.equal(accepted, 3, "valid A/D/E artifact candidates must reach the core listener");

const wrongPrefix = dispatch(
  artifactMessage("D", "A-1720000000000-aaaa1111"),
  104
);
assert.equal(wrongPrefix.response?.ok, false);
assert.equal(wrongPrefix.response?.rejectedBy, "artifact-provenance-gate");
assert.match(wrongPrefix.response?.error || "", /bound AI side/i);

const staleGeneration = dispatch(
  artifactMessage("D", "D-1720000000000-stale999"),
  104
);
assert.equal(staleGeneration.response?.ok, false);
assert.equal(staleGeneration.response?.rejectedBy, "artifact-provenance-gate");
assert.match(staleGeneration.response?.error || "", /stale|does not match/i);

const unboundSender = dispatch(artifactMessage("E"), 999);
assert.equal(unboundSender.response?.ok, false);
assert.equal(unboundSender.response?.rejectedBy, "artifact-provenance-gate");
assert.match(unboundSender.response?.error || "", /not a bound AI tab/i);

const unobserved = artifactMessage("E");
unobserved.observed = false;
const unobservedResult = dispatch(unobserved, 105);
assert.equal(unobservedResult.response?.ok, false);
assert.equal(unobservedResult.response?.rejectedBy, "artifact-provenance-gate");
assert.match(unobservedResult.response?.error || "", /DOM-observed/i);

assert.equal(accepted, 3, "rejected candidates must never reach the core artifact handler");

console.log("Dynamic A-E artifact provenance regression checks passed.");
