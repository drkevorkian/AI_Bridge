import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "dashboard-provider-health-start-gate.js"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "dashboard-bootstrap.js"), "utf8");

assert.match(bootstrap, /dashboard-provider-health-start-gate\.js/);
assert.match(bootstrap, /providerHealthStartGateAdapter:\s*true/);
assert.match(source, /failClosedStartState:\s*true/);
assert.match(source, /preservesLegacySessionControl:\s*true/);
assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|eval\s*\(|new Function/);

class FakeElement {
  constructor(id) {
    this.id = id;
    this.value = "";
    this.disabled = false;
    this.title = "";
    this.dataset = {};
    this.attributes = new Map();
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "title") this.title = "";
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
}

const elements = new Map();
const agentCount = new FakeElement("agentCount");
agentCount.value = "3";
elements.set("agentCount", agentCount);
const start = new FakeElement("start");
elements.set("start", start);
for (const side of ["A", "B", "C", "D", "E"]) {
  const badge = new FakeElement(`health${side}`);
  badge.dataset.status = "CHECKING";
  elements.set(`health${side}`, badge);
}

const body = {};
let observer = null;
let observerConfig = null;
let legacyUpdateCalls = 0;
let latestState = { sessionActive: false };

class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback;
    observer = this;
  }
  observe(target, config) {
    assert.equal(target, body);
    observerConfig = config;
  }
}

function updateControls(state) {
  legacyUpdateCalls += 1;
  start.disabled = Boolean(state?.sessionActive);
}

const windowObject = {};
const context = vm.createContext({
  window: windowObject,
  document: {
    body,
    documentElement: {},
    getElementById(id) {
      return elements.get(id) || null;
    }
  },
  MutationObserver: FakeMutationObserver,
  updateControls,
  latestState,
  Object, Array, Number, String, Boolean, Map, Set, console
});
context.globalThis = context;
vm.runInContext(source, context, { filename: "dashboard-provider-health-start-gate.js" });

const api = windowObject.__AI_BRIDGE_PROVIDER_HEALTH_START_GATE_V1__;
assert.equal(api.version, 1);
assert.equal(api.failClosedStartState, true);
assert.equal(api.preservesLegacySessionControl, true);
assert.deepEqual(Array.from(observerConfig.attributeFilter), ["data-status", "data-agent-count", "disabled"]);

// Initial CHECKING state is fail-closed: Start must not look actionable before
// Provider Health has verified every active slot.
assert.equal(start.disabled, true);
assert.equal(start.dataset.providerHealthBlocked, "true");
assert.equal(start.getAttribute("aria-disabled"), "true");
assert.match(start.title, /AI A, AI B, AI C/);

// READY for all live slots releases only the health-owned gate and hands the
// final disabled state back to legacy session controls.
for (const side of ["A", "B", "C"]) elements.get(`health${side}`).dataset.status = "READY";
observer.callback([{ type: "attributes", attributeName: "data-status" }]);
assert.equal(legacyUpdateCalls, 1);
assert.equal(start.disabled, false);
assert.equal(start.dataset.providerHealthBlocked, undefined);
assert.equal(start.getAttribute("aria-disabled"), null);

// Any non-READY active slot disables Start again. Inactive D/E must not matter.
elements.get("healthB").dataset.status = "GENERATING";
observer.callback([{ type: "attributes", attributeName: "data-status" }]);
assert.equal(start.disabled, true);
assert.match(start.title, /AI B/);
elements.get("healthD").dataset.status = "MISSING_TAB";
api.syncStartGate();
assert.match(start.title, /AI B/);
assert.doesNotMatch(start.title, /AI D/);

// Expanding the live roster makes D health-relevant immediately.
agentCount.value = "4";
observer.callback([{ type: "attributes", attributeName: "data-agent-count" }]);
assert.match(start.title, /AI B, AI D/);

// A legacy control update must not leave an unhealthy Start button enabled;
// observing the disabled attribute re-applies the one-way health gate.
start.disabled = false;
observer.callback([{ type: "attributes", attributeName: "disabled" }]);
assert.equal(start.disabled, true);

// When health recovers during an active session, releasing the health gate must
// preserve the legacy session disable instead of enabling Start itself.
elements.get("healthB").dataset.status = "READY";
elements.get("healthD").dataset.status = "READY";
context.latestState = { sessionActive: true };
observer.callback([{ type: "attributes", attributeName: "data-status" }]);
assert.equal(start.disabled, true);
assert.equal(start.dataset.providerHealthBlocked, undefined);

console.log("provider-health-start-gate: ok");
