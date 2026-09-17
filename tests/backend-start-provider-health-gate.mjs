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
assert.match(source, /probeActiveAgents\(\{\s*force:\s*true\s*\}\)/);
assert.match(source, /provider health is not READY/);

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

const context = vm.createContext({
  console,
  Object,
  Array,
  String,
  Boolean,
  Error,
  Promise,
  state: {
    sessionActive: true,
    running: false,
    paused: false
  },
  bindCalls: 0,
  resetCalls: 0,
  probeCalls: 0,
  nextHealth: health({ A: "READY", B: "READY" }),
  async bindTabsFromMessage() {
    context.bindCalls += 1;
    return "bound";
  },
  async resetSelectedChats() {
    context.resetCalls += 1;
    return ["A", "B"];
  },
  async probeActiveAgents(options) {
    context.probeCalls += 1;
    assert.deepEqual(options, { force: true });
    return context.nextHealth;
  }
});
context.globalThis = context;
vm.runInContext(source, context, { filename: "start-provider-health-hardening.js" });

// Normal fresh START must be independently blocked by backend health even if a
// caller bypasses the dashboard's disabled Start button.
context.nextHealth = health({ A: "READY", B: "UNREACHABLE" });
await assert.rejects(
  () => context.bindTabsFromMessage({ freshChats: false }),
  /AI B \(UNREACHABLE\)/
);
assert.equal(context.bindCalls, 1);
assert.equal(context.probeCalls, 1);

context.nextHealth = health({ A: "READY", B: "READY" });
assert.equal(await context.bindTabsFromMessage({ freshChats: false }), "bound");
assert.equal(context.probeCalls, 2);

// With fresh chats requested, do not approve the old conversations. Bind first,
// navigate/reset them, then force the health decision against the new pages.
context.nextHealth = health({ A: "READY", B: "DUPLICATE_THREAD" });
assert.equal(await context.bindTabsFromMessage({ freshChats: true }), "bound");
assert.equal(context.probeCalls, 2, "fresh-chat START must defer its probe until after reset");
await assert.rejects(
  () => context.resetSelectedChats({}, ["A", "B"], { allowActive: true }),
  /AI B \(DUPLICATE_THREAD\)/
);
assert.equal(context.resetCalls, 1);
assert.equal(context.probeCalls, 3);

// Resume has its own recovery semantics; this hardening slice only closes the
// fresh START boundary and must not inject a new readiness prerequisite there.
context.state.paused = true;
context.nextHealth = health({ A: "UNREACHABLE", B: "UNREACHABLE" });
assert.equal(await context.bindTabsFromMessage({ freshChats: false }), "bound");
assert.equal(context.probeCalls, 3, "paused-session rebind must not be treated as a fresh START");

assert.equal(context.__AI_BRIDGE_START_PROVIDER_HEALTH_GATE_V1__.backendStartRequiresReadyProviders, true);
assert.equal(context.__AI_BRIDGE_START_PROVIDER_HEALTH_GATE_V1__.probesAfterFreshChatReset, true);
assert.equal(context.__AI_BRIDGE_START_PROVIDER_HEALTH_GATE_V1__.doesNotSendProviderPrompts, true);

console.log("backend-start-provider-health-gate: ok");