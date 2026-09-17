import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capsSrc = fs.readFileSync(path.join(root, "agent-capabilities.js"), "utf8");
const overlaySrc = fs.readFileSync(path.join(root, "coordinator-dynamic-agents.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");

assert.match(background, /SIDES = \["A", "B", "C"\]/);
assert.ok(wrapper.includes('importScripts("coordinator-dynamic-agents.js")'));
assert.ok(wrapper.indexOf('importScripts("background.js")') < wrapper.indexOf('importScripts("coordinator-dynamic-agents.js")'));
assert.ok(wrapper.indexOf('importScripts("coordinator-dynamic-agents.js")') < wrapper.indexOf('importScripts("artifact-fetch-runtime-hardening.js")'));

const tabs = new Map([
  [11, { id: 11, url: "https://chatgpt.com/" }],
  [22, { id: 22, url: "https://grok.com/" }],
  [33, { id: 33, url: "https://claude.ai/" }],
  [44, { id: 44, url: "https://gemini.google.com/" }],
  [55, { id: 55, url: "https://copilot.microsoft.com/" }],
  [66, { id: 66, url: "https://chatgpt.com/c/other" }]
]);

function same(actual, expected) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

function loadOverlay(state) {
  const context = vm.createContext({
    URL, console, Object, Array, Number, String, Boolean, Set, Map, Promise, RangeError, Error,
    SIDES: ["A", "B", "C"],
    state,
    emptySideMap(value) { return { A: value, B: value, C: value }; },
    normalizeActiveSides(raw) { return Array.isArray(raw) ? raw : ["A", "B", "C"]; },
    nextSide(side) { return side === "A" ? "B" : side === "B" ? "C" : "A"; },
    tabForSide(side) { return context.state[`tab${side}`] ?? null; },
    sideForTab() { return null; },
    sanitizeForceRelaySides(raw) { return [].concat(raw || []); },
    cloneDefaultState() { return { agentCount: 3, tabA: null, tabB: null, tabC: null }; },
    async bindTabsFromMessage() { throw new Error("legacy bind reached"); },
    async ensureTabListener() {},
    isBatchWorkMode() { return false; },
    async saveState() { context.saved = true; },
    chrome: {
      tabs: {
        async get(id) {
          if (!tabs.has(Number(id))) throw new Error("no tab");
          return tabs.get(Number(id));
        }
      },
      runtime: {
        getURL() { return "chrome-extension://bridge/"; },
        onMessage: { addListener() {} }
      }
    }
  });
  context.globalThis = context;
  vm.runInContext(capsSrc, context, { filename: "agent-capabilities.js" });
  vm.runInContext(overlaySrc, context, { filename: "coordinator-dynamic-agents.js" });
  return context;
}

const migrated = loadOverlay({
  tabA: 11, tabB: 22, tabC: 33, startSide: "A", mainSide: "A", currentSide: "B"
});
assert.equal(migrated.state.agentCount, 3);
same(Array.from(migrated.SIDES), ["A", "B", "C"]);
assert.equal(migrated.state.tabD, null);
assert.equal(migrated.nextSide("C"), "A");

const applied = await migrated.applyAgentCount(5, { persist: false });
same(applied.sides, ["A", "B", "C", "D", "E"]);
assert.equal(migrated.nextSide("E"), "A");
assert.equal(migrated.nextSide("C"), "D");

migrated.state.sessionActive = true;
await assert.rejects(() => migrated.applyAgentCount(4, { persist: false }), /Stop the session/);
migrated.state.sessionActive = false;

migrated.state.tabA = 11; migrated.state.tabB = 22; migrated.state.tabC = 33;
migrated.state.tabD = 44; migrated.state.tabE = 55;
assert.equal(migrated.sideForTab(44), "D");

await migrated.bindTabsFromMessage({ tabA: 11, tabB: 22, tabC: 33, tabD: 44, tabE: 55 });
await assert.rejects(
  () => migrated.bindTabsFromMessage({ tabA: 11, tabB: 11, tabC: 33, tabD: 44, tabE: 55 }),
  /different browser tab/
);
await assert.rejects(
  () => migrated.bindTabsFromMessage({ tabA: 11, tabB: 22, tabC: 33, tabD: 44, tabE: 66 }),
  /Duplicate-provider/
);

const shrinking = loadOverlay({ agentCount: 5, currentSide: "E", startSide: "E", mainSide: "E" });
await shrinking.applyAgentCount(2, { persist: false });
same(Array.from(shrinking.SIDES), ["A", "B"]);
assert.equal(shrinking.state.startSide, "A");
same(shrinking.sanitizeForceRelaySides(["A", "C", "E", "A"]), ["A"]);

assert.equal(migrated.__AI_BRIDGE_DYNAMIC_AGENTS_V1__.uniqueTabBinding, true);
assert.equal(migrated.__AI_BRIDGE_DYNAMIC_AGENTS_V1__.duplicateProviderAgentsEnabled, false);
console.log("dynamic-agent-coordinator: ok");
