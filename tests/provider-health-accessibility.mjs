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
assert.match(bootstrap, /version:\s*11/);
assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|eval\s*\(|new Function/);
assert.match(src, /textOnlyRendering:\s*true/);
assert.match(src, /politeStatusAnnouncements:\s*true/);
assert.match(src, /deduplicatedStatusAnnouncements:\s*true/);

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.dataset = {};
    this.title = "";
    this.attributes = new Map();
    this.children = [];
    this.style = {};
    this.textContent = "";
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
  appendChild(child) {
    this.children.push(child);
    if (child.id) elements.set(child.id, child);
    return child;
  }
}

class FakeBadge extends FakeElement {
  constructor(id, status = "CHECKING", title = "") {
    super(id);
    this.dataset = { status };
    this.title = title;
  }
}

const elements = new Map([
  ["healthA", new FakeBadge("healthA", "READY", "READY")],
  ["healthB", new FakeBadge("healthB", "DISCONNECTED", "Tab not connected")],
  ["healthC", new FakeBadge("healthC", "DUPLICATE_THREAD", "Same conversation thread")],
  ["healthD", new FakeBadge("healthD", "SELECTOR_DEGRADED", "Fallback selector active")],
  ["healthE", new FakeBadge("healthE", "CHECKING", "")]
]);
const team = new FakeElement("team");
let observer = null;
let observerConfig = null;

const document = {
  createElement() {
    return new FakeElement();
  },
  getElementById(id) {
    return elements.get(id) || null;
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
assert.equal(api.version, 2);
assert.equal(api.dynamicStatusNames, true);
assert.equal(api.textOnlyRendering, true);
assert.equal(api.politeStatusAnnouncements, true);
assert.equal(api.deduplicatedStatusAnnouncements, true);
assert.equal(api.refresh(), 5);
assert.deepEqual(Array.from(observerConfig.attributeFilter), ["data-status", "title"]);

const live = elements.get("providerHealthLiveRegion");
assert.ok(live, "accessibility adapter should create one dedicated provider-health live region");
assert.equal(live.getAttribute("role"), "status");
assert.equal(live.getAttribute("aria-live"), "polite");
assert.equal(live.getAttribute("aria-atomic"), "true");
assert.equal(live.textContent, "", "initial health hydration should seed silently instead of announcing every slot");

assert.equal(elements.get("healthA").getAttribute("aria-label"), "AI A health: READY");
assert.equal(elements.get("healthB").getAttribute("aria-label"), "AI B health: DISCONNECTED — Tab not connected");
assert.equal(elements.get("healthC").getAttribute("aria-label"), "AI C health: DUPLICATE THREAD — Same conversation thread");
assert.equal(elements.get("healthD").getAttribute("aria-label"), "AI D health: SELECTOR DEGRADED — Fallback selector active");
assert.equal(elements.get("healthE").getAttribute("aria-label"), "AI E health: CHECKING");

// Periodic health rendering can rewrite attributes even when values are identical.
// The live region must remain quiet unless the accessible health text changes.
observer.callback([{ type: "attributes", attributeName: "data-status" }]);
assert.equal(live.textContent, "", "unchanged periodic health polls must not be re-announced");

elements.get("healthD").dataset.status = "READY";
elements.get("healthD").title = "READY";
observer.callback([{ type: "attributes", attributeName: "data-status" }]);
assert.equal(elements.get("healthD").getAttribute("aria-label"), "AI D health: READY");
assert.equal(live.textContent, "AI D health: READY");

// A second identical mutation must not produce another announcement payload.
live.textContent = "";
observer.callback([{ type: "attributes", attributeName: "title" }]);
assert.equal(live.textContent, "", "identical status/title rewrites must stay deduplicated");

console.log("provider health accessibility regression: ok");
