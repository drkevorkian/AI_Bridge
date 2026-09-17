import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "dashboard-provider-health-accessibility.js"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "dashboard-bootstrap.js"), "utf8");

assert.ok(bootstrap.includes('dashboard-provider-health-accessibility.js'));
assert.match(bootstrap, /providerHealthAccessibilityAdapter:\s*true/);
assert.match(bootstrap, /version:\s*9/);
assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|eval\s*\(|new Function/);
assert.match(src, /textOnlyRendering:\s*true/);

class FakeBadge {
  constructor(id, status = "CHECKING", title = "") {
    this.id = id;
    this.dataset = { status };
    this.title = title;
    this.attributes = new Map();
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
}

const badges = new Map([
  ["healthA", new FakeBadge("healthA", "READY", "READY")],
  ["healthB", new FakeBadge("healthB", "DISCONNECTED", "Tab not connected")],
  ["healthC", new FakeBadge("healthC", "DUPLICATE_THREAD", "Same conversation thread")],
  ["healthD", new FakeBadge("healthD", "SELECTOR_DEGRADED", "Fallback selector active")],
  ["healthE", new FakeBadge("healthE", "CHECKING", "")]
]);
const team = {};
let observer = null;
let observerConfig = null;

const document = {
  getElementById(id) {
    return badges.get(id) || null;
  },
  querySelector(selector) {
    return selector === ".team-section" ? team : null;
  }
};

class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback;
    observer = this;
  }
  observe(target, config) {
    assert.equal(target, team);
    observerConfig = config;
  }
}

const context = vm.createContext({
  window: {},
  document,
  MutationObserver: FakeMutationObserver,
  Object,
  String,
  Array,
  Map,
  console
});
context.globalThis = context;
vm.runInContext(src, context, { filename: "dashboard-provider-health-accessibility.js" });

const api = context.window.__AI_BRIDGE_PROVIDER_HEALTH_ACCESSIBILITY_V1__;
assert.equal(api.version, 1);
assert.equal(api.dynamicStatusNames, true);
assert.equal(api.textOnlyRendering, true);
assert.equal(api.refresh(), 5);
assert.deepEqual(Array.from(observerConfig.attributeFilter), ["data-status", "title"]);

assert.equal(badges.get("healthA").getAttribute("aria-label"), "AI A health: READY");
assert.equal(badges.get("healthB").getAttribute("aria-label"), "AI B health: DISCONNECTED — Tab not connected");
assert.equal(badges.get("healthC").getAttribute("aria-label"), "AI C health: DUPLICATE THREAD — Same conversation thread");
assert.equal(badges.get("healthD").getAttribute("aria-label"), "AI D health: SELECTOR DEGRADED — Fallback selector active");
assert.equal(badges.get("healthE").getAttribute("aria-label"), "AI E health: CHECKING");

badges.get("healthD").dataset.status = "READY";
badges.get("healthD").title = "READY";
observer.callback([{ type: "attributes", attributeName: "data-status" }]);
assert.equal(badges.get("healthD").getAttribute("aria-label"), "AI D health: READY");

console.log("provider health accessibility regression: ok");
