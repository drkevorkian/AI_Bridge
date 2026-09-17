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
assert.match(src, /type:\s*"AI_BRIDGE_ADAPTIVE_SELECT"/,
  "badges must consume the already-redacted adaptive/health endpoint");
assert.match(src, /viewpointIndexFromRosterOrder:\s*true/);
assert.match(src, /usesRedactedProviderHealth:\s*true/);
assert.match(src, /exposesSensitiveIdentity:\s*false/);
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

function element(initial = {}) {
  return {
    textContent: "",
    title: "",
    hidden: true,
    value: "",
    dataset: {},
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    ...initial
  };
}

const elements = new Map([
  ["adaptiveRecommendation", element({ hidden: false })],
  ["startSide", element({ hidden: false, value: "A" })],
  ["threadBadgeA", element()],
  ["threadBadgeB", element()],
  ["threadBadgeC", element()]
]);

let observed = false;
class FakeMutationObserver {
  constructor(callback) { this.callback = callback; }
  observe(target) {
    assert.equal(target, elements.get("adaptiveRecommendation"));
    observed = true;
  }
  disconnect() {}
}

let messageCount = 0;
const health = {
  version: 1,
  sides: ["A", "B", "C"],
  bySide: {
    A: { providerId: "chatgpt", providerName: "ChatGPT", threadPath: "/c/alpha", status: "READY", ready: true },
    B: { providerId: "chatgpt", providerName: "ChatGPT", threadPath: "/c/beta", status: "READY", ready: true },
    C: { providerId: "grok", providerName: "Grok", threadPath: "/", status: "READY", ready: true }
  }
};

const context = vm.createContext({
  console,
  Object,
  Array,
  Map,
  String,
  Promise,
  Error,
  queueMicrotask,
  MutationObserver: FakeMutationObserver,
  document: {
    hidden: false,
    getElementById(id) { return elements.get(id) || null; }
  },
  chrome: {
    runtime: {
      async sendMessage(message) {
        messageCount += 1;
        assert.equal(message.type, "AI_BRIDGE_ADAPTIVE_SELECT");
        assert.equal(message.force, false);
        assert.equal(message.preferredSide, "A");
        return { ok: true, health, recommendation: { side: "A", reason: "A is READY." } };
      }
    }
  }
});
context.window = context;
context.window.addEventListener = () => {};

vm.runInContext(src, context, { filename: "dashboard-viewpoint-badges.js" });
await new Promise(resolve => setTimeout(resolve, 0));

assert.equal(observed, true, "badge adapter must reuse the adaptive recommendation mutation cadence");
assert.equal(messageCount, 1, "startup should perform one cosmetic cached health read");

const a = elements.get("threadBadgeA");
const b = elements.get("threadBadgeB");
const c = elements.get("threadBadgeC");
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

// A provider represented by only one active logical agent is not relabeled as
// a viewpoint. Its existing thread badge state remains under the dynamic health
// renderer's control.
assert.equal(c.textContent, "");
assert.equal(c.hidden, true);

console.log("dashboard-viewpoint-badges: ok");
