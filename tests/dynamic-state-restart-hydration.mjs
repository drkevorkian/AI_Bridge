import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "dynamic-state-restart-hardening.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

assert.ok(wrapper.includes('importScripts("dynamic-state-restart-hardening.js")'));
assert.ok(
  wrapper.indexOf('importScripts("coordinator-dynamic-agents.js")') <
    wrapper.indexOf('importScripts("dynamic-state-restart-hardening.js")')
);
assert.ok(
  wrapper.indexOf('importScripts("dynamic-state-restart-hardening.js")') <
    wrapper.indexOf('importScripts("coordinator-dynamic-semantics.js")')
);
assert.match(wrapper, /restoresServiceWorkerQueue !== false/);

const ALL_SIDES = ["A", "B", "C", "D", "E"];
const caps = Object.freeze({
  version: 1,
  defaultAgentCount: 3,
  normalizeAgentCount(raw, fallback = 3) {
    const value = Number(raw);
    return Number.isInteger(value) && value >= 1 && value <= 5 ? value : fallback;
  },
  sideIdsForCount(count) {
    const value = this.normalizeAgentCount(count, this.defaultAgentCount);
    return ALL_SIDES.slice(0, value);
  }
});

function createContext({ persisted, current }) {
  const dynamicAgents = Object.freeze({
    version: 1,
    migrateDynamicAgentState(target) {
      const sides = caps.sideIdsForCount(target.agentCount);
      target.activeSides = [...sides];
      return target;
    }
  });
  const context = vm.createContext({
    console,
    Object,
    Array,
    Number,
    String,
    Boolean,
    Set,
    Map,
    Promise,
    Error,
    chrome: {
      storage: {
        local: {
          async get(key) {
            assert.equal(key, "bridgeState");
            return { bridgeState: persisted };
          }
        }
      }
    },
    state: current,
    stateReady: Promise.resolve(),
    loadState: async () => current,
    __AI_BRIDGE_AGENT_CAPABILITIES__: caps,
    __AI_BRIDGE_DYNAMIC_AGENTS_V1__: dynamicAgents,
    __AI_BRIDGE_STATE_V4_PERSISTENCE_V1__: {
      version: 1,
      hydratePersistedState(snapshot) {
        if (Number(snapshot?.stateVersion) !== 4) return snapshot;
        const toSide = value => {
          const match = /^agent-([1-5])$/.exec(String(value || ""));
          return match ? ALL_SIDES[Number(match[1]) - 1] : null;
        };
        const rosterCount = Array.isArray(snapshot?.roster?.agents) ? snapshot.roster.agents.length : 3;
        const out = { ...snapshot, agentCount: rosterCount };
        for (const field of ["startSide", "mainSide", "currentSide"]) {
          out[field] = toSide(snapshot[field]);
        }
        for (const field of ["cycleParticipants", "phasePendingSides", "phaseSentSides", "phaseCompletedSides"]) {
          out[field] = (Array.isArray(snapshot[field]) ? snapshot[field] : []).map(toSide).filter(Boolean);
        }
        return out;
      }
    }
  });
  context.globalThis = context;
  vm.runInContext(src, context, { filename: "dynamic-state-restart-hardening.js" });
  return context;
}

const persistedFive = {
  stateVersion: 3,
  agentCount: 5,
  workMode: "review",
  startSide: "E",
  mainSide: "E",
  currentSide: "D",
  cycleParticipants: ["A", "B", "D", "E", "D", "Z"],
  phasePendingSides: ["D", "E", "D", "Z"],
  phaseSentSides: ["A", "D"],
  phaseCompletedSides: ["B", "E", "E"]
};
const filteredFive = {
  stateVersion: 3,
  agentCount: 5,
  workMode: "review",
  startSide: "E",
  mainSide: "A",
  currentSide: "D",
  activeSides: ["A", "B", "C", "D", "E"],
  cycleParticipants: ["A", "B"],
  phasePendingSides: [],
  phaseSentSides: ["A"],
  phaseCompletedSides: ["B"]
};
const five = createContext({ persisted: persistedFive, current: filteredFive });
await five.stateReady;
assert.equal(five.state.startSide, "E");
assert.equal(five.state.mainSide, "E", "five-agent restart must restore persisted Main AI E");
assert.equal(five.state.currentSide, "D");
assert.deepEqual([...five.state.cycleParticipants], ["A", "B", "D", "E"]);
assert.deepEqual([...five.state.phasePendingSides], ["D", "E"]);
assert.deepEqual([...five.state.phaseSentSides], ["A", "D"]);
assert.deepEqual([...five.state.phaseCompletedSides], ["B", "E"]);
assert.deepEqual([...five.state.activeSides], ALL_SIDES);
assert.equal(five.__AI_BRIDGE_DYNAMIC_RESTART_HYDRATION_V1__.restoresServiceWorkerQueue, false);
assert.equal(five.__AI_BRIDGE_DYNAMIC_RESTART_HYDRATION_V1__.hydratesCanonicalStateV4BeforeRestore, true);

const persistedThree = {
  stateVersion: 3,
  agentCount: 3,
  workMode: "parallel",
  startSide: "A",
  mainSide: "D",
  currentSide: "E",
  cycleParticipants: ["A", "D", "B", "E"],
  phasePendingSides: ["A", "D", "C", "E"],
  phaseSentSides: ["D", "B"],
  phaseCompletedSides: ["E", "C"]
};
const currentThree = {
  stateVersion: 3,
  agentCount: 3,
  workMode: "parallel",
  startSide: "A",
  mainSide: "A",
  currentSide: "A",
  activeSides: ["A", "B", "C"],
  cycleParticipants: [],
  phasePendingSides: [],
  phaseSentSides: [],
  phaseCompletedSides: []
};
const three = createContext({ persisted: persistedThree, current: currentThree });
await three.stateReady;
assert.equal(three.state.mainSide, "A", "inactive persisted D must not be restored into a three-agent roster");
assert.equal(three.state.currentSide, "A", "inactive persisted E must not be restored into a three-agent roster");
assert.deepEqual([...three.state.cycleParticipants], ["A", "B"]);
assert.deepEqual([...three.state.phasePendingSides], ["A", "C"]);
assert.deepEqual([...three.state.phaseSentSides], ["B"]);
assert.deepEqual([...three.state.phaseCompletedSides], ["C"]);

const persistedRelay = {
  stateVersion: 3,
  agentCount: 5,
  workMode: "relay",
  startSide: "A",
  mainSide: "E",
  currentSide: "D",
  cycleParticipants: ["A", "D"],
  phasePendingSides: ["D", "E"],
  phaseSentSides: ["D"],
  phaseCompletedSides: ["E"]
};
const currentRelay = {
  stateVersion: 3,
  agentCount: 5,
  workMode: "relay",
  startSide: "A",
  mainSide: "A",
  currentSide: "D",
  activeSides: ALL_SIDES.slice(),
  cycleParticipants: [],
  phasePendingSides: [],
  phaseSentSides: [],
  phaseCompletedSides: []
};
const relay = createContext({ persisted: persistedRelay, current: currentRelay });
await relay.stateReady;
assert.equal(relay.state.mainSide, "E");
assert.deepEqual([...relay.state.cycleParticipants], ["A", "D"]);
assert.deepEqual([...relay.state.phasePendingSides], [], "sequential restart must not resurrect batch-only phase state");
assert.deepEqual([...relay.state.phaseSentSides], []);
assert.deepEqual([...relay.state.phaseCompletedSides], []);

const mismatch = {
  stateVersion: 999,
  agentCount: 5,
  workMode: "review",
  mainSide: "E",
  phasePendingSides: ["D", "E"]
};
const currentMismatch = {
  stateVersion: 3,
  agentCount: 5,
  workMode: "review",
  mainSide: "A",
  phasePendingSides: []
};
const mismatchContext = createContext({ persisted: mismatch, current: currentMismatch });
await mismatchContext.stateReady;
assert.equal(mismatchContext.state.mainSide, "A", "state-version mismatch must fail closed");
assert.deepEqual([...mismatchContext.state.phasePendingSides], []);

console.log("dynamic-state-restart-hydration: ok");


const persistedV4 = {
  stateVersion: 4,
  roster: {
    version: 2,
    nextOrdinal: 6,
    agents: ALL_SIDES.map((side, index) => ({
      id: `agent-${index + 1}`,
      ordinal: index + 1,
      legacySide: side,
      label: `AI ${side}`,
      job: "",
      tabId: null
    }))
  },
  workMode: "review",
  startSide: "agent-5",
  mainSide: "agent-5",
  currentSide: "agent-4",
  cycleParticipants: ["agent-1", "agent-4", "agent-5"],
  phasePendingSides: ["agent-4", "agent-5"],
  phaseSentSides: ["agent-1", "agent-4"],
  phaseCompletedSides: ["agent-2", "agent-5"]
};
const currentV4 = {
  stateVersion: 4,
  roster: persistedV4.roster,
  agentCount: 5,
  workMode: "review",
  startSide: "E",
  mainSide: "A",
  currentSide: "D",
  activeSides: ALL_SIDES.slice(),
  cycleParticipants: ["A"],
  phasePendingSides: [],
  phaseSentSides: ["A"],
  phaseCompletedSides: ["B"]
};
const v4 = createContext({ persisted: persistedV4, current: currentV4 });
await v4.stateReady;
assert.equal(v4.state.mainSide, "E", "canonical V4 Main AI must restore through the runtime projection");
assert.equal(v4.state.currentSide, "D");
assert.deepEqual([...v4.state.cycleParticipants], ["A", "D", "E"]);
assert.deepEqual([...v4.state.phasePendingSides], ["D", "E"]);
assert.deepEqual([...v4.state.phaseSentSides], ["A", "D"]);
assert.deepEqual([...v4.state.phaseCompletedSides], ["B", "E"]);
