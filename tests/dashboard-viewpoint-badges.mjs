import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "dashboard-viewpoint-badges.js"), "utf8");
const activation = fs.readFileSync(path.join(root, "dashboard-viewpoint-activation.js"), "utf8");

assert.match(activation, /dashboard-viewpoint-badges\.js/,
  "viewpoint activation must load the sanitized badge adapter");
assert.match(activation, /sanitizedViewpointBadges:\s*true/,
  "dynamic dashboard diagnostics must advertise sanitized viewpoint badges");
assert.match(src, /usesCommittedDashboardHealth:\s*true/,
  "badge diagnostics must advertise committed dashboard health reuse");
assert.match(src, /dashboard\.getCommittedHealth\(\)/,
  "badges must consume the dynamic dashboard's already-committed health snapshot");
assert.doesNotMatch(src, /chrome\.runtime\.sendMessage/,
  "cosmetic viewpoint badges must not issue their own worker request");
assert.doesNotMatch(src, /AI_BRIDGE_ADAPTIVE_SELECT/,
  "cosmetic viewpoint badges must not independently query Adaptive Selector");
assert.match(src, /viewpointIndexFromRosterOrder:\s*true/);
assert.match(src, /usesRedactedProviderHealth:\s*true/);
assert.match(src, /exposesSensitiveIdentity:\s*false/);
assert.match(src, /cardDescribedBySanitizedViewpoint:\s*true/,
  "viewpoint diagnostics must advertise the accessible card-description relationship");
assert.match(src, /aria-describedby/,
  "duplicate-provider agent cards must be described by their sanitized viewpoint badge");
assert.match(src, /\.textContent\s*=\s*visibleText/,
  "untrusted/provider-derived badge text must use textContent");
assert.doesNotMatch(src, /\.innerHTML\s*=/,
  "viewpoint badges must never render provider data through innerHTML");
assert.doesNotMatch(src, /\btabId\b/,
  "raw Chrome tab IDs must not enter the viewpoint badge adapter");
assert.doesNotMatch(src, /\bthreadKey\b/,
  "internal thread keys must not enter the viewpoint badge adapter");
assert.doesNotMatch(src, /\bprovenanceId\b/,
  "provenance identifiers must not enter the viewpoint badge adapter");
assert.doesNotMatch(src, /setInterval\s*\(/,
  "viewpoint badges must reuse the existing health cadence instead of adding a timer");
assert.doesNotMatch(src, /aria-roledescription/,
  "plain viewpoint spans should not invent a custom ARIA role description");

function element(initial = {}) {
  return {
    id: "",
    textContent: "",
    title: "",
    hidden: true,
    value: "",
    dataset: {},
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; },
    removeAttribute(name) { delete this.attributes[name]; },
    ...initial
  };
}

const elements = new Map([
  ["adaptiveRecommendation", element({ id: "adaptiveRecommendation", hidden: false })],
  ["threadBadgeA", element({ id: "threadBadgeA" })],
  ["threadBadgeB", element({ id: "threadBadgeB" })],
  ["threadBadgeC", element({ id: "threadBadgeC" })]
]);
const cards = new Map([
  [".agent-card.agent-a", element({ id: "cardA", hidden: false, attributes: { "aria-labelledby": "labelTextA" } })],
  [".agent-card.agent-b", element({ id: "cardB", hidden: false, attributes: { "aria-labelledby": "labelTextB", "aria-describedby": "existingB" } })],
  [".agent-card.agent-c", element({ id: "cardC", hidden: false, attributes: { "aria-labelledby": "labelTextC" } })]
]);

let observed = false;
let observerCallback = null;
class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback;
    observerCallback = callback;
  }
  observe(target) {
    assert.equal(target, elements.get("adaptiveRecommendation"));
    observed = true;
  }
  disconnect() {}
}

let health = {
  version: 1,
  sides: ["A", "B", "C"],
  bySide: {
    A: { providerId: "chatgpt", providerName: "ChatGPT", threadPath: "/c/alpha", status: "READY", ready: true },
    B: { providerId: "chatgpt", providerName: "ChatGPT", threadPath: "/c/beta", status: "READY", ready: true },
    C: { providerId: "grok", providerName: "Grok", threadPath: "/", status: "READY", ready: true }
  }
};
let committedReads = 0;

const context = vm.createContext({
  console,
  Object,
  Array,
  Map,
  Set,
  String,
  Promise,
  Error,
  queueMicrotask,
  MutationObserver: FakeMutationObserver,
  document: {
    hidden: false,
    getElementById(id) { return elements.get(id) || null; },
    querySelector(selector) { return cards.get(selector) || null; }
  }
});
context.window = context;
context.window.addEventListener = () => {};
context.window.__AI_BRIDGE_DYNAMIC_DASHBOARD_V1__ = Object.freeze({
  version: 1,
  committedHealthSnapshot: true,
  getCommittedHealth() {
    committedReads += 1;
    return health;
  }
});

vm.runInContext(src, context, { filename: "dashboard-viewpoint-badges.js" });
await new Promise(resolve => setTimeout(resolve, 0));

assert.equal(observed, true, "badge adapter must reuse the adaptive recommendation mutation cadence");
assert.equal(committedReads, 1, "startup should read the already-committed dashboard snapshot exactly once");

const a = elements.get("threadBadgeA");
const b = elements.get("threadBadgeB");
const c = elements.get("threadBadgeC");
const cardA = cards.get(".agent-card.agent-a");
const cardB = cards.get(".agent-card.agent-b");
const cardC = cards.get(".agent-card.agent-c");
assert.equal(a.textContent, "Viewpoint #1 · /c/alpha");
assert.equal(b.textContent, "Viewpoint #2 · /c/beta");
assert.equal(a.hidden, false);
assert.equal(b.hidden, false);
assert.match(a.attributes["aria-label"], /ChatGPT viewpoint 1 of 2/);
assert.match(b.attributes["aria-label"], /ChatGPT viewpoint 2 of 2/);
assert.equal(a.dataset.viewpointIndex, "1");
assert.equal(b.dataset.viewpointIndex, "2");
assert.equal(a.dataset.viewpointCount, "2");
assert.equal(b.dataset.viewpointCount, "2");
assert.equal(a.dataset.viewpointOwned, "true");
assert.equal(b.dataset.viewpointOwned, "true");

assert.equal(cardA.attributes["aria-labelledby"], "labelTextA");
assert.equal(cardA.attributes["aria-describedby"], "threadBadgeA");
assert.equal(cardB.attributes["aria-labelledby"], "labelTextB");
assert.equal(cardB.attributes["aria-describedby"], "existingB threadBadgeB");
assert.equal(c.textContent, "");
assert.equal(c.hidden, true);
assert.equal(cardC.attributes["aria-describedby"], undefined);

// A later atomic dashboard commit changes the authoritative snapshot. Simulate
// the existing recommendation mutation and verify the badge adapter re-reads the
// dashboard snapshot without contacting the worker.
health = {
  version: 1,
  sides: ["A", "B", "C"],
  bySide: {
    A: { providerId: "chatgpt", providerName: "ChatGPT", threadPath: "/c/alpha", status: "READY", ready: true },
    B: { providerId: "claude", providerName: "Claude", threadPath: "/chat/beta", status: "READY", ready: true },
    C: { providerId: "grok", providerName: "Grok", threadPath: "/", status: "READY", ready: true }
  }
};
observerCallback?.([]);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(committedReads, 2, "each recommendation mutation should perform one synchronous committed-snapshot read");
assert.equal(cardA.attributes["aria-describedby"], undefined);
assert.equal(cardB.attributes["aria-describedby"], "existingB");
assert.equal(a.hidden, true);
assert.equal(b.hidden, true);
assert.equal(a.dataset.viewpointOwned, undefined);
assert.equal(b.dataset.viewpointOwned, undefined);
assert.equal(a.attributes["aria-label"], undefined);
assert.equal(b.attributes["aria-label"], undefined);

console.log("dashboard-viewpoint-badges: ok");
