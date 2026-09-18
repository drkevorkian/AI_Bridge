import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capsSrc = fs.readFileSync(path.join(root, "agent-capabilities.js"), "utf8");
const rosterSrc = fs.readFileSync(path.join(root, "roster-state-adapter.js"), "utf8");
const source = fs.readFileSync(path.join(root, "coordinator-dynamic-agents.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

assert.match(wrapper, /revokesRetiredTabAuthority !== true/);
assert.match(wrapper, /pausesOnBoundTabReplacement !== true/);
assert.match(wrapper, /neverAutoTrustsReplacementTab !== true/);

const removedListeners = [];
const replacedListeners = [];
const saves = [];
const logs = [];
const state = {
  sessionActive: true,
  running: true,
  paused: false,
  pauseReason: "",
  agentCount: 3,
  activeSides: ["A", "B", "C"],
  tabA: 101,
  tabB: 202,
  tabC: 303,
  labelA: "AI A", labelB: "AI B", labelC: "AI C",
  jobA: "", jobB: "", jobC: "",
  generationIdBySide: { A: "gen-a", B: "gen-b", C: null },
  viewpointIdentityBySide: {
    A: { provenanceId: "old-a", threadKey: "/c/a", providerFamily: "chatgpt", boundTabId: 101 },
    B: { provenanceId: "old-b", threadKey: "/c/b", providerFamily: "grok", boundTabId: 202 }
  },
  phasePendingSides: ["A", "B", "C"],
  phaseSentSides: ["A", "B"],
  lastResponseBySide: { A: "old", B: "old" }
};

const caps = {
  version: 1,
  supportedAgentSides: ["A", "B", "C", "D", "E"],
  defaultAgentCount: 3,
  maxUniqueProviderAgents: 5,
  duplicateProviderAgentsEnabled: true,
  normalizeAgentCount(value, fallback) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : fallback;
  },
  parseAgentCount(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
  },
  sideIdsForCount(count) { return ["A", "B", "C", "D", "E"].slice(0, count); },
  evaluateAgentBindings() { return { ok: true, errors: [] }; },
  providerFamilyForUrl() { return { id: "chatgpt" }; }
};

const sandbox = {
  console,
  Date,
  Number,
  String,
  Object,
  Array,
  Set,
  Promise,
  globalThis: null,
  state,
  stateReady: Promise.resolve(),
  SIDES: ["A", "B", "C"],
  DEFAULT_STATE: {},
  __AI_BRIDGE_AGENT_CAPABILITIES__: caps,
  tabForSide(side) { return state[`tab${side}`]; },
  ensureTabListener: async () => true,
  isBatchWorkMode: () => true,
  appendLog(entry) { logs.push(entry); },
  async clearWatchdogAlarm() {},
  async saveState() { saves.push(JSON.parse(JSON.stringify(state))); },
  loadState: async () => state,
  chrome: {
    tabs: {
      async get(id) { return { id, url: "https://chatgpt.com/c/test" }; },
      onRemoved: { addListener(fn) { removedListeners.push(fn); } },
      onReplaced: { addListener(fn) { replacedListeners.push(fn); } }
    },
    runtime: {
      getURL: () => "chrome-extension://test/",
      onMessage: { addListener() {} }
    }
  }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(rosterSrc, sandbox, { filename: "roster-state-adapter.js" });
vm.runInContext(source, sandbox, { filename: "coordinator-dynamic-agents.js" });
await Promise.resolve();

assert.equal(removedListeners.length, 1);
assert.equal(replacedListeners.length, 1);
const contract = sandbox.__AI_BRIDGE_DYNAMIC_AGENTS_V1__;
assert.equal(contract.revokesRetiredTabAuthority, true);
assert.equal(contract.pausesOnBoundTabReplacement, true);
assert.equal(contract.neverAutoTrustsReplacementTab, true);

// Chrome replacement is not a close event. The retired bound ID must lose all
// coordinator authority and the newly-added ID must not be auto-bound.
replacedListeners[0](909, 101);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(state.tabA, null);
assert.equal(state.tabA === 909, false);
assert.equal(state.generationIdBySide.A, null);
assert.equal(Object.prototype.hasOwnProperty.call(state.viewpointIdentityBySide, "A"), false);
assert.equal(state.running, false);
assert.equal(state.paused, true);
assert.match(state.pauseReason, /replaced by Chrome/);
assert.deepEqual(state.phaseSentSides, ["B"]);
assert.equal(Object.prototype.hasOwnProperty.call(state.lastResponseBySide, "A"), false);
assert.ok(saves.length >= 1);
assert.match(logs.at(-1).text, /replaced by Chrome/);

// A normal close also revokes any still-armed capability/provenance. Capture of
// the owning side occurs at event time so this remains safe alongside the legacy
// onRemoved listener, which may clear the binding independently.
state.running = true;
state.paused = false;
state.tabB = 202;
state.generationIdBySide.B = "gen-b2";
state.viewpointIdentityBySide.B = { provenanceId: "b2", threadKey: "/c/b2", providerFamily: "grok", boundTabId: 202 };
removedListeners[0](202);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(state.tabB, null);
assert.equal(state.generationIdBySide.B, null);
assert.equal(Object.prototype.hasOwnProperty.call(state.viewpointIdentityBySide, "B"), false);
assert.equal(state.running, false);
assert.equal(state.paused, true);

console.log("dynamic-tab-retirement: replacement/close authority revoked ok");
