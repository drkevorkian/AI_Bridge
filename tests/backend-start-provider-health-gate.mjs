import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "start-provider-health-hardening.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

assert.match(wrapper, /importScripts\("provider-health-runtime\.js"\)[\s\S]*?importScripts\("start-provider-health-hardening\.js"\)/);
assert.match(wrapper, /backendStartRequiresReadyProviders\s*!==\s*true/);
assert.match(wrapper, /probesAfterFreshChatReset\s*!==\s*true/);
assert.match(wrapper, /restoresPersistedStateOnRejectedFreshStart\s*!==\s*true/);
assert.match(source, /probeActiveAgents\(\{\s*force:\s*true\s*\}\)/);
assert.match(source, /restorePersistedBridgeState/);

function health(statusBySide) {
  const sides = Object.keys(statusBySide);
  return Object.freeze({
    sides,
    bySide: Object.freeze(Object.fromEntries(sides.map(side => [
      side,
      Object.freeze({ side, status: statusBySide[side], ready: statusBySide[side] === "READY" })
    ])))
  });
}

let persisted = { sessionActive: false, marker: "idle-before-start" };
const context = vm.createContext({
  console, Object, Array, String, Boolean, Error, Promise,
  chrome: {
    storage: {
      local: {
        async get() { return persisted === undefined ? {} : { bridgeState: persisted }; },
        async set(pack) { if (Object.prototype.hasOwnProperty.call(pack, "bridgeState")) persisted = pack.bridgeState; },
        async remove(key) { if (key === "bridgeState") persisted = undefined; }
      }
    }
  },
  state: { sessionActive: true, running: false, paused: false },
  bindCalls: 0,
  resetCalls: 0,
  probeCalls: 0,
  nextHealth: health({ A: "READY", B: "READY" }),
  async bindTabsFromMessage() { context.bindCalls += 1; return "bound"; },
  async resetSelectedChats() {
    context.resetCalls += 1;
    persisted = { sessionActive: true, marker: "temporary-fresh-start" };
    return ["A", "B"];
  },
  async probeActiveAgents(options) {
    context.probeCalls += 1;
    assert.equal(options?.force, true);
    return context.nextHealth;
  }
});
context.globalThis = context;
vm.runInContext(source, context, { filename: "start-provider-health-hardening.js" });

context.nextHealth = health({ A: "READY", B: "UNREACHABLE" });
await assert.rejects(() => context.bindTabsFromMessage({ freshChats: false }), /AI B \(UNREACHABLE\)/);
assert.equal(context.bindCalls, 1);
assert.equal(context.probeCalls, 1);

context.nextHealth = health({ A: "READY", B: "READY" });
assert.equal(await context.bindTabsFromMessage({ freshChats: false }), "bound");
assert.equal(context.probeCalls, 2);

// Fresh-chat START persists temporary state during reset. If the post-reset
// health probe rejects START, the pre-start persisted snapshot must be restored.
persisted = { sessionActive: false, marker: "idle-before-start" };
context.nextHealth = health({ A: "READY", B: "DUPLICATE_THREAD" });
assert.equal(await context.bindTabsFromMessage({ freshChats: true }), "bound");
await assert.rejects(
  () => context.resetSelectedChats({}, ["A", "B"], { allowActive: true }),
  /AI B \(DUPLICATE_THREAD\)/
);
assert.equal(persisted.sessionActive, false);
assert.equal(persisted.marker, "idle-before-start");
assert.equal(context.resetCalls, 1);
assert.equal(context.probeCalls, 3);

// Resume remains outside the fresh-start health gate.
context.state.paused = true;
context.nextHealth = health({ A: "UNREACHABLE", B: "UNREACHABLE" });
assert.equal(await context.bindTabsFromMessage({ freshChats: false }), "bound");
assert.equal(context.probeCalls, 3);

assert.equal(context.__AI_BRIDGE_START_PROVIDER_HEALTH_GATE_V1__.backendStartRequiresReadyProviders, true);
assert.equal(context.__AI_BRIDGE_START_PROVIDER_HEALTH_GATE_V1__.probesAfterFreshChatReset, true);
assert.equal(context.__AI_BRIDGE_START_PROVIDER_HEALTH_GATE_V1__.restoresPersistedStateOnRejectedFreshStart, true);
assert.equal(context.__AI_BRIDGE_START_PROVIDER_HEALTH_GATE_V1__.doesNotSendProviderPrompts, true);

console.log("backend-start-provider-health-gate: ok");
