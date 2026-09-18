import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capsSrc = fs.readFileSync(path.join(root, "agent-capabilities.js"), "utf8");
const rosterSrc = fs.readFileSync(path.join(root, "roster-state-adapter.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

assert.ok(wrapper.includes('importScripts("roster-state-adapter.js")'));
assert.ok(
  wrapper.indexOf('importScripts("roster-state-adapter.js")') <
    wrapper.indexOf('importScripts("background.js")')
);
assert.ok(
  wrapper.indexOf('importScripts("roster-state-adapter.js")') <
    wrapper.indexOf('importScripts("coordinator-dynamic-agents.js")')
);

const context = vm.createContext({
  URL, console, Object, Array, Number, String, Boolean, Set, Map, Promise,
  RangeError, TypeError, Error
});
context.globalThis = context;
vm.runInContext(capsSrc, context, { filename: "agent-capabilities.js" });
vm.runInContext(rosterSrc, context, { filename: "roster-state-adapter.js" });

const api = context.__AI_BRIDGE_ROSTER_STATE_ADAPTER_V1__;
assert.ok(api);
assert.equal(api.version, 1);
assert.equal(api.storageAuthority, "roster-v2");
assert.equal(api.legacyProjectionEphemeral, true);
assert.equal(api.runtimeWritesRosterV2, true);
assert.equal(api.persistsSecondRosterRepresentation, false);
assert.equal(api.validatesSideKeys, true);
assert.equal(api.runtimeAgentReferences, true);
assert.deepEqual(Array.from(api.writeFieldAllowlist), ["tabId", "label", "job"]);

const state = {
  agentCount: 3,
  tabA: 11,
  labelA: "Lead",
  jobA: "Lead developer",
  tabB: 22,
  labelB: "Backend",
  jobB: "Backend developer",
  tabC: 33
};

const adapter = new context.AgentRosterStateAdapter(state);
adapter.ensureLegacyFields();
assert.equal(state.tabD, null);
assert.equal(state.labelE, "AI E");
assert.equal(state.jobE, "");

assert.deepEqual(
  JSON.parse(JSON.stringify(adapter.get("a"))),
  { side: "A", tabId: 11, label: "Lead", job: "Lead developer" }
);
assert.deepEqual(Array.from(adapter.sides()), ["A", "B", "C"]);

const updated = adapter.set("B", {
  tabId: 44,
  label: "Security reviewer",
  job: "Audit backend",
  constructor: { polluted: true },
  prototype: { polluted: true },
  __proto__: { polluted: true }
});
assert.equal(updated.tabId, 44);
assert.equal(state.tabB, 44);
assert.equal(state.labelB, "Security reviewer");
assert.equal(state.jobB, "Audit backend");
assert.equal(Object.prototype.polluted, undefined);
assert.equal(state.constructor, Object.prototype.constructor);
assert.equal(Object.prototype.hasOwnProperty.call(state, "prototype"), false);

assert.throws(() => adapter.set("Z", { tabId: 1 }), /Unknown logical-agent reference|Unknown logical-agent side/);
assert.throws(() => adapter.set("__proto__", { tabId: 1 }), /Unknown logical-agent reference|Unknown logical-agent side/);
assert.throws(() => adapter.get("agent-6"), /inactive|current roster/i);
assert.throws(() => adapter.set("A", { tabId: -1 }), /positive integer or null/);

const snapshot = adapter.snapshot();
assert.equal(snapshot.length, 3);
assert.deepEqual(Array.from(snapshot, item => item.side), ["A", "B", "C"]);
assert.equal(Object.isFrozen(snapshot), true);
assert.equal(Object.isFrozen(snapshot[0]), true);

// V3 remains supported only as a migration compatibility path.
state.agentCount = 5;
assert.deepEqual(Array.from(adapter.sides()), ["A", "B", "C", "D", "E"]);
assert.equal(Object.prototype.hasOwnProperty.call(state, "agents"), false);
assert.equal(Object.prototype.hasOwnProperty.call(state, "agentRoster"), false);

// V4 writes mutate roster.agents[] first and synchronize legacy fields only as
// ephemeral mirrors. Duplicate tab IDs are rejected at the adapter boundary.
const v4 = {
  stateVersion: 4,
  agentCount: 3,
  roster: {
    version: 2,
    nextOrdinal: 4,
    agents: [
      { id: "agent-1", ordinal: 1, legacySide: "A", label: "Lead", job: "Lead", tabId: 101 },
      { id: "agent-2", ordinal: 2, legacySide: "B", label: "Back", job: "Backend", tabId: 202 },
      { id: "agent-3", ordinal: 3, legacySide: "C", label: "Front", job: "Frontend", tabId: 303 }
    ]
  }
};
const v4Adapter = new context.AgentRosterStateAdapter(v4);
v4Adapter.ensureLegacyFields();
assert.equal(v4.tabA, 101);
assert.equal(v4.labelB, "Back");
assert.equal(v4.jobC, "Frontend");
v4Adapter.set("B", { label: "Security", tabId: 404 });
assert.equal(v4.roster.agents[1].label, "Security");
assert.equal(v4.roster.agents[1].tabId, 404);
assert.equal(v4.labelB, "Security");
assert.equal(v4.tabB, 404);
assert.throws(() => v4Adapter.set("C", { tabId: 404 }), /different browser tab/i);

v4Adapter.setCount(5);
assert.equal(v4.roster.agents.length, 5);
assert.equal(v4.roster.nextOrdinal, 6);
assert.deepEqual(Array.from(v4Adapter.sides()), ["A", "B", "C", "D", "E"]);
assert.equal(v4.roster.agents[3].id, "agent-4");
assert.equal(v4.roster.agents[4].legacySide, "E");
assert.equal(v4Adapter.get("agent-5").side, "E");
assert.equal(v4Adapter.get("agent-5").runtimeKey, "E");

v4Adapter.setCount(2);
assert.equal(v4.roster.agents.length, 2);
assert.equal(v4.roster.nextOrdinal, 3);
assert.equal(v4.tabC, null);
assert.throws(() => v4Adapter.set("C", { job: "inactive" }), /inactive logical agent/i);

console.log("roster-state-adapter: ok");
