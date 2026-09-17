import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "dashboard-dynamic-accessibility.js"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "dashboard-bootstrap.js"), "utf8");

assert.ok(bootstrap.includes('dashboard-dynamic-accessibility.js'));
assert.match(bootstrap, /dynamicAccessibilityAdapter:\s*true/);
assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML/);
assert.match(src, /textOnlyRendering:\s*true/);

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.attributes = new Map();
    this.titleNode = null;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
  querySelector(selector) {
    if (selector === ".agent-identity > strong" || selector === ".agent-topline strong") return this.titleNode;
    return null;
  }
}

const sides = ["A", "B", "C", "D", "E"];
const ids = new Map();
const cards = new Map();
for (const side of sides) {
  const card = new FakeElement();
  const title = new FakeElement(side === "D" || side === "E" ? `labelText${side}` : "");
  card.titleNode = title;
  cards.set(side, card);
  if (title.id) ids.set(title.id, title);
  for (const prefix of ["tab", "job", "newChat", "resend", "useLast"]) {
    ids.set(`${prefix}${side}`, new FakeElement(`${prefix}${side}`));
  }
}
const team = new FakeElement("team");
let observerConfig = null;

const document = {
  getElementById(id) {
    return ids.get(id) || null;
  },
  querySelector(selector) {
    const sideMatch = selector.match(/^\.agent-([a-e])$/i);
    if (sideMatch) return cards.get(sideMatch[1].toUpperCase()) || null;
    if (selector === ".team-section") return team;
    return null;
  }
};

class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback;
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
  Map,
  String,
  Array,
  console
});
context.globalThis = context;
vm.runInContext(src, context, { filename: "dashboard-dynamic-accessibility.js" });

const api = context.window.__AI_BRIDGE_DYNAMIC_ACCESSIBILITY_V1__;
assert.equal(api.version, 1);
assert.equal(api.sideSpecificControlNames, true);
assert.equal(api.labelsStaticAndDynamicCards, true);
assert.equal(api.textOnlyRendering, true);
assert.equal(api.refresh(), 5);
assert.deepEqual(Array.from(observerConfig?.attributeFilter || []), ["data-agent-count"]);

for (const side of sides) {
  const title = cards.get(side).titleNode;
  assert.equal(title.id, `labelText${side}`, `AI ${side} title must have a stable accessible id`);
  // The adapter's byId lookup runs before static A/B/C titles receive IDs, so
  // querySelector supplies them and the card is associated directly.
  assert.equal(cards.get(side).getAttribute("aria-labelledby"), `labelText${side}`);
  assert.equal(ids.get(`tab${side}`).getAttribute("aria-label"), `AI ${side} tab`);
  assert.equal(ids.get(`job${side}`).getAttribute("aria-label"), `AI ${side} job / responsibility`);
  assert.equal(ids.get(`newChat${side}`).getAttribute("aria-label"), `AI ${side} new chat`);
  assert.equal(ids.get(`resend${side}`).getAttribute("aria-label"), `AI ${side} resend last prompt`);
  assert.equal(ids.get(`useLast${side}`).getAttribute("aria-label"), `AI ${side} use last reply for manual relay`);
}

console.log("dynamic accessibility regression: ok");
