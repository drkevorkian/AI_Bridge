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
  wrapper.indexOf('importScripts("background.js")') <
    wrapper.indexOf('importScripts("roster-state-adapter.js")')
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
assert.equal(api.storageAuthority, "legacy-per-side-fields");
assert.equal(api.persistsSecondRosterRepresentation, false);
assert.equal(api.validatesSideKeys, true);
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

assert.throws(() => adapter.set("Z", { tabId: 1 }), /Unknown logical-agent side/);
assert.throws(() => adapter.set("__proto__", { tabId: 1 }), /Unknown logical-agent side/);
assert.throws(() => adapter.set("A", { tabId: -1 }), /positive integer or null/);

const snapshot = adapter.snapshot();
assert.equal(snapshot.length, 3);
assert.deepEqual(Array.from(snapshot, item => item.side), ["A", "B", "C"]);
assert.equal(Object.isFrozen(snapshot), true);
assert.equal(Object.isFrozen(snapshot[0]), true);

// Changing the logical count only changes which existing legacy fields are
// projected; this adapter never creates a second persisted roster object.
state.agentCount = 5;
assert.deepEqual(Array.from(adapter.sides()), ["A", "B", "C", "D", "E"]);
assert.equal(Object.prototype.hasOwnProperty.call(state, "agents"), false);
assert.equal(Object.prototype.hasOwnProperty.call(state, "agentRoster"), false);

console.log("roster-state-adapter: ok");
