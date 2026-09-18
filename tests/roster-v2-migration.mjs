import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capsSrc = fs.readFileSync(path.join(root, "agent-capabilities.js"), "utf8");
const migrationSrc = fs.readFileSync(path.join(root, "roster-v2-migration.js"), "utf8");

assert.doesNotMatch(migrationSrc, /chrome\.storage|saveState|storage\.local|storage\.sync/,
  "Slice 76 migrator must remain pure and side-effect free");

function load() {
  const context = vm.createContext({
    URL, console, Object, Array, Number, String, Boolean, Set, Map, Promise,
    RangeError, TypeError, Error
  });
  context.globalThis = context;
  vm.runInContext(capsSrc, context, { filename: "agent-capabilities.js" });
  vm.runInContext(migrationSrc, context, { filename: "roster-v2-migration.js" });
  return context.__AI_BRIDGE_ROSTER_V2_MIGRATION_V1__;
}

const migration = load();
assert.ok(migration);
assert.equal(migration.version, 1);
assert.equal(migration.sourceStateVersion, 3);
assert.equal(migration.targetStateVersion, 4);
assert.equal(migration.rosterVersion, 2);
assert.equal(migration.noPersistenceSideEffects, true);

const legacy = {
  stateVersion: 3,
  agentCount: 5,
  tabA: 11, labelA: "Lead", jobA: "Lead developer",
  tabB: 22, labelB: "Backend", jobB: "Backend developer",
  tabC: 33, labelC: "Frontend", jobC: "Frontend designer",
  tabD: 44, labelD: "Audit", jobD: "Security auditor",
  tabE: 55, labelE: "Research", jobE: "Research specialist",
  transcript: [{ text: "must not leak into roster" }],
  oauthClientId: "must-not-copy"
};

const first = migration.buildRosterV2FromLegacyState(legacy);
const second = migration.buildRosterV2FromLegacyState(legacy);

assert.equal(JSON.stringify(first), JSON.stringify(second), "migration must be deterministic");
assert.equal(first.stateVersion, 4);
assert.equal(first.roster.version, 2);
assert.equal(first.roster.nextOrdinal, 6);
assert.equal(first.roster.agents.length, 5);
assert.deepEqual(
  Array.from(first.roster.agents, a => a.id),
  ["agent-1", "agent-2", "agent-3", "agent-4", "agent-5"]
);
assert.deepEqual(
  Array.from(first.roster.agents, a => a.legacySide),
  ["A", "B", "C", "D", "E"]
);
assert.deepEqual(
  Array.from(first.roster.agents, a => a.tabId),
  [11, 22, 33, 44, 55]
);
assert.equal("transcript" in first, false);
assert.equal("oauthClientId" in first, false);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.roster), true);
assert.equal(Object.isFrozen(first.roster.agents), true);
assert.equal(Object.isFrozen(first.roster.agents[0]), true);
assert.equal(migration.validateRosterV2(first.roster), true);

// Pre-agentCount v3 snapshots retain the historical default of three agents.
const legacyThree = migration.buildRosterV2FromLegacyState({
  stateVersion: 3,
  tabA: 101,
  tabB: null,
  tabC: 303
});
assert.equal(legacyThree.roster.agents.length, 3);
assert.equal(legacyThree.roster.nextOrdinal, 4);
assert.equal(legacyThree.roster.agents[1].tabId, null);

// Labels/jobs are reconstructed through bounded allowlisted fields only.
const bounded = migration.buildRosterV2FromLegacyState({
  stateVersion: 3,
  agentCount: 1,
  labelA: "x".repeat(500),
  jobA: "  " + "y".repeat(5000) + "  "
});
assert.equal(bounded.roster.agents[0].label.length, migration.maxLabelChars);
assert.equal(bounded.roster.agents[0].job.length, migration.maxJobChars);
assert.equal(bounded.roster.agents[0].job.startsWith("y"), true);

// Invalid legacy snapshots fail closed.
for (const bad of [null, [], "state"]) {
  assert.throws(() => migration.buildRosterV2FromLegacyState(bad));
}
assert.throws(
  () => migration.buildRosterV2FromLegacyState({ stateVersion: 2 }),
  error => error?.name === "RangeError" && /stateVersion 3/.test(String(error?.message || ""))
);
assert.throws(
  () => migration.buildRosterV2FromLegacyState({ stateVersion: 3, agentCount: 6 }),
  error => error?.name === "RangeError" && /1 to 5/.test(String(error?.message || ""))
);
assert.throws(
  () => migration.buildRosterV2FromLegacyState({ stateVersion: 3, agentCount: 1, tabA: -7 }),
  /invalid legacy tab binding/i
);
assert.throws(
  () => migration.buildRosterV2FromLegacyState({
    stateVersion: 3,
    agentCount: 2,
    tabA: 77,
    tabB: 77
  }),
  /duplicate browser tab binding 77/i
);

// V2 validation rejects object maps, malformed/colliding IDs, and duplicate tabs.
assert.throws(
  () => migration.validateRosterV2({ version: 2, agents: { "agent-1": {} } }),
  /agents must be an array/i
);
assert.throws(
  () => migration.validateRosterV2({
    version: 2,
    agents: [{ id: "__proto__", ordinal: 1, tabId: null }]
  }),
  /canonical and consistent/i
);
assert.throws(
  () => migration.validateRosterV2({
    version: 2,
    agents: [
      { id: "agent-1", ordinal: 1, tabId: 10 },
      { id: "agent-1", ordinal: 1, tabId: 20 }
    ]
  }),
  /duplicate agent identity/i
);
assert.throws(
  () => migration.validateRosterV2({
    version: 2,
    agents: [
      { id: "agent-1", ordinal: 1, tabId: 10 },
      { id: "agent-2", ordinal: 2, tabId: 10 }
    ]
  }),
  /duplicate browser tab binding 10/i
);

// Canonical identities beyond E validate independently from the current
// five-agent runtime policy, which remains unchanged until Slice 81.
assert.equal(
  migration.validateRosterV2({
    version: 2,
    agents: [{ id: "agent-27", ordinal: 27, tabId: null }]
  }),
  true
);

console.log("roster-v2-migration: isolated deterministic migration helpers ok");
