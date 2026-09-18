import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capsSrc = fs.readFileSync(path.join(root, "agent-capabilities.js"), "utf8");
const migrationSrc = fs.readFileSync(path.join(root, "roster-v2-migration.js"), "utf8");
const persistenceSrc = fs.readFileSync(path.join(root, "state-v4-persistence.js"), "utf8");

function load() {
  const context = vm.createContext({
    URL, console, Object, Array, Number, String, Boolean, Set, Map, Promise,
    RangeError, TypeError, Error
  });
  context.globalThis = context;
  vm.runInContext(capsSrc, context, { filename: "agent-capabilities.js" });
  vm.runInContext(migrationSrc, context, { filename: "roster-v2-migration.js" });
  vm.runInContext(persistenceSrc, context, { filename: "state-v4-persistence.js" });
  return context.__AI_BRIDGE_STATE_V4_PERSISTENCE_V1__;
}

const api = load();
assert.ok(api);
assert.equal(api.version, 1);
assert.equal(api.sourceStateVersion, 3);
assert.equal(api.targetStateVersion, 4);
assert.equal(api.rosterVersion, 2);
assert.equal(api.legacyProjectionIsEphemeral, true);
assert.equal(api.persistsLegacyRosterFields, false);
assert.equal(api.canonicalizesAgentReferences, true);
assert.equal(api.canonicalizesExecutionMaps, true);
assert.equal(api.runtimeAgentReferencesDecoupledFromLegacyAliases, true);
assert.equal(api.importsLegacyRuntimeRefsInV4, true);
assert.equal(api.recoversStaleRuntimeRefsInV4, true);
assert.equal(api.canonicalRosterRemainsStrictDuringRecovery, true);
assert.equal(api.noStorageSideEffects, true);

const v3 = {
  stateVersion: 3,
  agentCount: 5,
  tabA: 11, labelA: "Lead", jobA: "Lead developer",
  tabB: 22, labelB: "Backend", jobB: "Backend developer",
  tabC: 33, labelC: "Frontend", jobC: "Frontend designer",
  tabD: 44, labelD: "Audit", jobD: "Security",
  tabE: 55, labelE: "Research", jobE: "Research",
  sessionActive: true,
  running: false,
  paused: true,
  pauseReason: "test",
  currentSide: "D",
  startSide: "A",
  mainSide: "B",
  activeSides: ["A", "B", "C", "D", "E"],
  cycleParticipants: ["A", "C"],
  phasePendingSides: ["D", "E"],
  phaseSentSides: ["D"],
  phaseCompletedSides: ["A", "B"],
  generationIdBySide: { A: "gen-a", D: "gen-d", E: null },
  viewpointIdentityBySide: {
    D: { providerFamily: "chatgpt", threadKey: "https://chatgpt.com/c/d", boundTabId: 44 }
  },
  lastDeliveredSeqBySide: { A: 1, B: 2, C: 3, D: 4, E: 5 },
  lastResponseBySide: { D: "response-d" },
  transcript: [{ seq: 1, type: "human", text: "hello" }],
  nextSeq: 2,
  unknownSecretField: "drop-me"
};

const migrated = api.migrateV3State(v3);
assert.equal(migrated.stateVersion, 4);
assert.equal(migrated.roster.version, 2);
assert.equal(migrated.roster.agents.length, 5);
assert.equal(migrated.roster.agents[3].id, "agent-4");
assert.equal(migrated.roster.agents[3].tabId, 44);
assert.equal(migrated.currentSide, "agent-4");
assert.equal(migrated.startSide, "agent-1");
assert.equal(migrated.mainSide, "agent-2");
assert.deepEqual(Array.from(migrated.activeSides), [
  "agent-1", "agent-2", "agent-3", "agent-4", "agent-5"
]);
assert.deepEqual(Array.from(migrated.phasePendingSides), ["agent-4", "agent-5"]);
assert.equal(migrated.generationIdBySide["agent-1"], "gen-a");
assert.equal(migrated.generationIdBySide["agent-4"], "gen-d");
assert.equal(migrated.viewpointIdentityBySide["agent-4"].boundTabId, 44);
assert.equal(migrated.lastResponseBySide["agent-4"], "response-d");

for (const forbidden of [
  "agentCount",
  "tabA", "tabB", "tabC", "tabD", "tabE",
  "labelA", "labelB", "labelC", "labelD", "labelE",
  "jobA", "jobB", "jobC", "jobD", "jobE",
  "unknownSecretField"
]) {
  assert.equal(Object.prototype.hasOwnProperty.call(migrated, forbidden), false, `${forbidden} must not persist in V4`);
}

const hydrated = api.hydratePersistedState(migrated);
assert.equal(hydrated.stateVersion, 4);
assert.equal(hydrated.agentCount, 5);
assert.equal(hydrated.currentSide, "D");
assert.equal(hydrated.startSide, "A");
assert.equal(hydrated.mainSide, "B");
assert.deepEqual(Array.from(hydrated.phasePendingSides), ["D", "E"]);
assert.equal(hydrated.generationIdBySide.A, "gen-a");
assert.equal(hydrated.generationIdBySide.D, "gen-d");
assert.equal(hydrated.viewpointIdentityBySide.D.boundTabId, 44);
assert.equal(hydrated.tabD, 44);
assert.equal(hydrated.labelD, "Audit");
assert.equal(hydrated.jobD, "Security");

const roundTrip = api.serializeRuntimeState(hydrated);
assert.equal(JSON.stringify(roundTrip), JSON.stringify(migrated),
  "V4 serialize/hydrate must be deterministic and idempotent");

// Transitional V4 builds could persist legacy A-E runtime refs inside an
// otherwise canonical V4 snapshot. Hydration must import those refs without
// weakening the canonical write format.
const hybridV4 = {
  ...migrated,
  currentSide: "D",
  startSide: "A",
  mainSide: "B",
  activeSides: ["A", "B", "C", "D", "E"],
  phasePendingSides: ["D", "E"],
  generationIdBySide: { A: "gen-a", D: "gen-d" },
  lastResponseBySide: { D: "response-d" }
};
const hybridHydrated = api.hydratePersistedState(hybridV4);
assert.equal(hybridHydrated.currentSide, "D");
assert.equal(hybridHydrated.startSide, "A");
assert.equal(hybridHydrated.mainSide, "B");
assert.deepEqual(Array.from(hybridHydrated.phasePendingSides), ["D", "E"]);
assert.equal(hybridHydrated.generationIdBySide.A, "gen-a");
assert.equal(hybridHydrated.generationIdBySide.D, "gen-d");
const repairedHybrid = api.serializeRuntimeState(hybridHydrated);
assert.equal(repairedHybrid.currentSide, "agent-4");
assert.equal(repairedHybrid.startSide, "agent-1");
assert.equal(repairedHybrid.mainSide, "agent-2");
assert.deepEqual(Array.from(repairedHybrid.phasePendingSides), ["agent-4", "agent-5"]);
assert.equal(repairedHybrid.generationIdBySide["agent-1"], "gen-a");
assert.equal(repairedHybrid.generationIdBySide["agent-4"], "gen-d");
assert.equal(Object.prototype.hasOwnProperty.call(repairedHybrid.generationIdBySide, "A"), false);
assert.equal(Object.prototype.hasOwnProperty.call(repairedHybrid.generationIdBySide, "D"), false);

// Stale non-authoritative runtime pointers must not brick dashboard startup.
// Canonical roster/tab authority remains strict; only runtime refs are repaired.
const staleRuntimeV4 = {
  ...migrated,
  currentSide: "totally-stale",
  startSide: "agent-999",
  mainSide: "F",
  activeSides: ["garbage", "agent-999"],
  cycleParticipants: ["A", "garbage", "agent-4"],
  phasePendingSides: ["agent-5", "bad-ref"],
  phaseSentSides: ["bad-ref"],
  phaseCompletedSides: ["agent-2"],
  generationIdBySide: {
    ["__proto__"]: "blocked",
    "agent-1": "gen-a",
    "garbage": "stale"
  }
};
assert.throws(
  () => api.hydratePersistedState(staleRuntimeV4),
  /forbidden key/i,
  "prototype-pollution keys must remain fatal even during runtime-ref recovery"
);

delete staleRuntimeV4.generationIdBySide["__proto__"];
const staleHydrated = api.hydratePersistedState(staleRuntimeV4);
assert.equal(staleHydrated.currentSide, null);
assert.equal(staleHydrated.startSide, "A");
assert.equal(staleHydrated.mainSide, "A");
assert.deepEqual(Array.from(staleHydrated.activeSides), ["A", "B", "C", "D", "E"]);
assert.deepEqual(Array.from(staleHydrated.cycleParticipants), ["A", "D"]);
assert.deepEqual(Array.from(staleHydrated.phasePendingSides), ["E"]);
assert.deepEqual(Array.from(staleHydrated.phaseSentSides), []);
assert.deepEqual(Array.from(staleHydrated.phaseCompletedSides), ["B"]);
assert.equal(staleHydrated.generationIdBySide.A, "gen-a");
assert.equal(Object.prototype.hasOwnProperty.call(staleHydrated.generationIdBySide, "garbage"), false);

const staleRepaired = api.serializeRuntimeState(staleHydrated);
assert.equal(staleRepaired.currentSide, null);
assert.equal(staleRepaired.startSide, "agent-1");
assert.equal(staleRepaired.mainSide, "agent-1");
assert.deepEqual(Array.from(staleRepaired.activeSides), [
  "agent-1", "agent-2", "agent-3", "agent-4", "agent-5"
]);
assert.equal(staleRepaired.generationIdBySide["agent-1"], "gen-a");
assert.equal(Object.prototype.hasOwnProperty.call(staleRepaired.generationIdBySide, "garbage"), false);

assert.throws(
  () => api.hydratePersistedState({
    ...migrated,
    generationIdBySide: { ["__proto__"]: "bad" }
  }),
  /forbidden key|malformed canonical agent ID/i
);
assert.throws(
  () => api.hydratePersistedState({
    ...migrated,
    currentSide: "agent-6"
  }),
  /outside the active roster/i
);
assert.throws(
  () => api.hydratePersistedState({
    ...migrated,
    roster: {
      version: 2,
      nextOrdinal: 3,
      agents: [
        { id: "agent-1", ordinal: 1, legacySide: "A", label: "A", job: "", tabId: 10 },
        { id: "agent-2", ordinal: 2, legacySide: "B", label: "B", job: "", tabId: 10 }
      ]
    }
  }),
  /duplicate browser tab binding/i
);

assert.throws(
  () => api.hydratePersistedState({
    stateVersion: 4,
    roster: {
      version: 2,
      nextOrdinal: 7,
      agents: Array.from({ length: 6 }, (_, index) => ({
        id: `agent-${index + 1}`,
        ordinal: index + 1,
        legacySide: index < 5 ? String.fromCharCode(65 + index) : null,
        label: `AI ${index + 1}`,
        job: "",
        tabId: null
      }))
    }
  }),
  /1 to 5 active agents|legacy compatibility aliases/i
);

assert.doesNotMatch(persistenceSrc, /chrome\.storage|storage\.local|storage\.sync/,
  "State V4 persistence helpers must remain pure");

console.log("state-v4-persistence: canonical-only atomic persistence boundary ok");
