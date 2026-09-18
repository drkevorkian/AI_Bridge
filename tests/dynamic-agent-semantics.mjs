import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");
const capsSrc = fs.readFileSync(path.join(root, "agent-capabilities.js"), "utf8");
const cloudV2Src = fs.readFileSync(path.join(root, "cloud-settings-v2.js"), "utf8");
const rosterSrc = fs.readFileSync(path.join(root, "roster-state-adapter.js"), "utf8");
const overlaySrc = fs.readFileSync(path.join(root, "coordinator-dynamic-semantics.js"), "utf8");
const adapter = fs.readFileSync(path.join(root, "dashboard-dynamic-agents.js"), "utf8");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");

assert.ok(wrapper.includes('importScripts("coordinator-dynamic-semantics.js")'));
assert.ok(
  wrapper.indexOf('importScripts("coordinator-dynamic-agents.js")') <
    wrapper.indexOf('importScripts("coordinator-dynamic-semantics.js")')
);
assert.match(background, /three-AI team/);
assert.match(adapter, /installCloudSettingsAugmenter/);
assert.match(adapter, /data\.agentCount = liveSides\(\)\.length/);

function load(agentCount) {
  const capsContext = vm.createContext({ URL, console, Object, Array, Number, String, Boolean, Set, Map, Promise, RangeError, Error });
  capsContext.globalThis = capsContext;
  vm.runInContext(capsSrc, capsContext, { filename: "agent-capabilities.js" });
  const caps = capsContext.__AI_BRIDGE_AGENT_CAPABILITIES__;
  const sides = [...caps.sideIdsForCount(agentCount)];
  const state = {
    agentCount,
    workMode: "relay",
    workPhase: "relay",
    startSide: "A",
    mainSide: "A",
    sessionActive: false
  };
  for (const side of caps.supportedAgentSides) {
    state[`job${side}`] = "";
    state[`label${side}`] = `AI ${side}`;
  }
  const context = vm.createContext({
    URL, console, Object, Array, Number, String, Boolean, Set, Map, Promise, RangeError, Error,
    SIDES: sides.slice(),
    state,
    caps,
    applyAgentCount: async (count) => {
      context.state.agentCount = count;
      context.SIDES.splice(0, context.SIDES.length, ...caps.sideIdsForCount(count));
    },
    saveState: async () => { context.saved = true; },
    minimumTurnsForWorkMode(mode) {
      if (mode === "review") return 6;
      if (mode === "compete" || mode === "parallel") return 3;
      return 1;
    },
    teamContext(side) {
      return [
        `You are AI ${side} (AI ${side}) in a three-AI team coordinated by AI Bridge.`,
        "Treat AI A, AI B, and AI C as collaborators on the same objective."
      ].join("\n");
    },
    workModeInstruction() {
      return [
        "You are competing with AI A, AI B, and AI C on the same objective.",
        "Work on the same objective simultaneously and independently from the other two AIs.",
        "Work as one member of a dynamically routed three-AI team.",
        "Review the other two AIs' primary responses below.",
        "You will receive the other two primary responses only after all three AIs finish this phase.",
        "Work in the normal A → B → C relay."
      ].join("\n");
    },
    initialMessage(side) {
      return {
        text: "Establish a strong shared starting point for the other two agents to improve.\nproduce something useful for the next two agents to build on."
      };
    },
    normalizeTargetToken(raw) {
      return String(raw || "")
        .trim()
        .replace(/[()[\]{}]/g, " ")
        .replace(/\s+/g, " ")
        .toLowerCase();
    },
    resolveCommandTarget(raw, fromSide = null) {
      const token = context.normalizeTargetToken(raw);
      const sideMatch = token.match(/(?:^|\b)ai\s*[-:]?\s*([abc])(?:\b|$)/i) || token.match(/^([abc])$/i);
      if (sideMatch) {
        const side = String(sideMatch[1]).toUpperCase();
        return side === fromSide ? null : side;
      }
      const matches = context.SIDES.filter(side => {
        const label = context.normalizeTargetToken(context.state[`label${side}`] || `AI ${side}`);
        if (!label) return false;
        return token === label || token.includes(label) || label.includes(token);
      });
      if (matches.length !== 1) return null;
      return matches[0] === fromSide ? null : matches[0];
    },
    bridgeCommandProtocolText() {
      if (context.state.workMode !== "mesh") return "";
      return [
        "DIRECT-MESH COMMAND PROTOCOL:",
        "SEND TO: AI A",
        "SEND TO: AI B",
        "SEND TO: AI C"
      ].join("\n");
    },
    requireBoundSessionTab() {
      throw new Error("Artifact fetch is only allowed from a currently bound AI A/B/C tab.");
    },
    forceRelayCapturedResponse: async () => ({ ok: true }),
    sanitizeCloudSettings(raw) {
      const src = raw || {};
      const canonical = context.__AI_BRIDGE_CLOUD_SETTINGS_V2__.normalizeRosterAndStart(src);
      return {
        schemaVersion: 2,
        roster: canonical.roster,
        startAgentId: canonical.startAgentId
      };
    },
    applyIdleCloudSettings: async function applyIdle(settings, { persist = true } = {}) {
      const projected = context.__AI_BRIDGE_CLOUD_SETTINGS_V2__.projectToLegacy(settings);
      for (const side of context.SIDES.filter(side => ["A", "B", "C"].includes(side))) {
        context.__AI_BRIDGE_ROSTER_STATE_ADAPTER_V1__.writeAgent(context.state, side, {
          job: projected[`job${side}`]
        });
      }
      context.state.startSide = projected.startSide;
      if (persist) await context.saveState();
    }
  });
  context.globalThis = context;
  context.__AI_BRIDGE_AGENT_CAPABILITIES__ = caps;
  vm.runInContext(cloudV2Src, context, { filename: "cloud-settings-v2.js" });
  vm.runInContext(rosterSrc, context, { filename: "roster-state-adapter.js" });
  context.__AI_BRIDGE_DYNAMIC_AGENTS_V1__ = Object.freeze({
    version: 1,
    liveSides: () => [...context.SIDES],
    liveCount: () => context.SIDES.length
  });
  vm.runInContext(overlaySrc, context, { filename: "coordinator-dynamic-semantics.js" });
  return context;
}

for (const count of [1, 3, 5]) {
  const ctx = load(count);
  assert.equal(ctx.minimumTurnsForWorkMode("compete"), count, `compete min for ${count}`);
  assert.equal(ctx.minimumTurnsForWorkMode("parallel"), count, `parallel min for ${count}`);
  assert.equal(ctx.minimumTurnsForWorkMode("review"), count * 2, `review min for ${count}`);
  assert.equal(ctx.minimumTurnsForWorkMode("relay"), 1);
  const prompt = ctx.teamContext("A");
  assert.match(prompt, new RegExp(`${count}-AI team`));
  assert.doesNotMatch(prompt, /three-AI team/);
  const mode = ctx.workModeInstruction("A");
  assert.doesNotMatch(mode, /three-AI team/);
  assert.doesNotMatch(mode, /all three AIs/);
  if (count === 5) {
    assert.match(mode, /A → B → C → D → E relay/);
    assert.match(mode, /AI A, AI B, AI C, AI D, and AI E/);
  }
  if (count === 1) {
    assert.match(mode, /independently\./);
  }
  const first = ctx.initialMessage("A");
  if (count === 1) {
    assert.match(first.text, /later teammates/);
  } else {
    assert.doesNotMatch(first.text, /other two agents/);
  }
}

const mesh = load(5);
mesh.state.workMode = "mesh";
assert.equal(mesh.resolveCommandTarget("AI D", "A"), "D", "five-agent Mesh should route explicit AI D targets");
assert.equal(mesh.resolveCommandTarget("E", "A"), "E", "five-agent Mesh should route shorthand E targets");
assert.equal(mesh.resolveCommandTarget("AI E", "E"), null, "Mesh must continue rejecting self-targets");
mesh.state.labelE = "Auditor";
assert.equal(mesh.resolveCommandTarget("Auditor", "A"), "E", "dynamic Mesh routing must preserve custom-label targets");
const meshProtocol = mesh.bridgeCommandProtocolText();
assert.match(meshProtocol, /SEND TO: AI D/);
assert.match(meshProtocol, /SEND TO: AI E/);
assert.equal(mesh.__AI_BRIDGE_DYNAMIC_SEMANTICS_V1__.liveRosterMeshTargets, true);
assert.equal(mesh.__AI_BRIDGE_DYNAMIC_SEMANTICS_V1__.meshTargetsUseLiveRuntimeKeys, true);

mesh.SIDES.splice(0, mesh.SIDES.length, "A", "agent-6");
assert.equal(mesh.resolveCommandTarget("agent-6", "A"), "agent-6",
  "Direct Mesh should accept a canonical F+ runtime key when it is present in the live roster");
assert.equal(mesh.resolveCommandTarget("AI agent-6", "A"), "agent-6",
  "Direct Mesh should accept the explicit AI agent-N form");
assert.equal(mesh.resolveCommandTarget("agent-6", "agent-6"), null,
  "Direct Mesh must reject F+ self-targets");

const threeMesh = load(3);
threeMesh.state.workMode = "mesh";
assert.equal(threeMesh.resolveCommandTarget("AI D", "A"), null, "inactive AI D must remain unavailable in a three-agent roster");
assert.doesNotMatch(threeMesh.bridgeCommandProtocolText(), /SEND TO: AI D/);

const cloud = load(3);
const stored = cloud.sanitizeCloudSettings({
  agentCount: 5,
  startSide: "E",
  jobA: "Lead",
  jobD: "Second viewpoint",
  jobE: "Auditor"
});
assert.equal(stored.schemaVersion, 2);
assert.equal(stored.roster.agents.length, 5);
assert.equal(stored.startAgentId, "agent-5");
assert.equal(stored.roster.agents[3].job, "Second viewpoint");
assert.equal(stored.roster.agents[4].job, "Auditor");
assert.equal(Object.prototype.hasOwnProperty.call(stored, "agentCount"), false);
assert.equal(Object.prototype.hasOwnProperty.call(stored, "jobD"), false);
await cloud.applyIdleCloudSettings(stored);
assert.equal(cloud.state.agentCount, 5);
assert.equal(cloud.state.startSide, "E");
assert.equal(cloud.state.jobE, "Auditor");
assert.equal(cloud.saved, true);

assert.throws(
  () => cloud.requireBoundSessionTab({}, "Artifact fetch"),
  /live team tab/
);

assert.equal(cloud.__AI_BRIDGE_DYNAMIC_SEMANTICS_V1__.derivedTurnMinimums, true);
assert.equal(cloud.__AI_BRIDGE_DYNAMIC_SEMANTICS_V1__.cloudSchemaVersion, 2);
assert.equal(cloud.__AI_BRIDGE_DYNAMIC_SEMANTICS_V1__.cloudCanonicalRosterOnly, true);
assert.equal(cloud.__AI_BRIDGE_DYNAMIC_SEMANTICS_V1__.cloudImportsSchemaV1, true);
assert.equal(cloud.__AI_BRIDGE_DYNAMIC_SEMANTICS_V1__.cloudJobWritesThroughRosterAdapter, true);
assert.equal(cloud.__AI_BRIDGE_DYNAMIC_SEMANTICS_V1__.cloudResizesRosterBeforeJobWrites, true);
assert.equal(cloud.__AI_BRIDGE_DYNAMIC_SEMANTICS_V1__.cloudSkipsInactiveRosterSlots, true);

// State V4: expanding from one agent to five must happen before D/E job writes,
// while a one-agent cloud profile must skip inactive B-E without throwing.
const cloudV4 = load(1);
cloudV4.state.stateVersion = 4;
cloudV4.state.roster = {
  version: 2,
  nextOrdinal: 2,
  agents: [{ id: "agent-1", ordinal: 1, legacySide: "A", label: "AI A", job: "", tabId: null }]
};
cloudV4.state.agentCount = 1;
cloudV4.applyAgentCount = async count => {
  cloudV4.__AI_BRIDGE_ROSTER_STATE_ADAPTER_V1__.setAgentCount(cloudV4.state, count);
  cloudV4.SIDES.splice(0, cloudV4.SIDES.length, ...cloudV4.__AI_BRIDGE_AGENT_CAPABILITIES__.sideIdsForCount(count));
};

await cloudV4.applyIdleCloudSettings({
  agentCount: 1,
  startSide: "A",
  jobA: "Solo",
  jobB: "inactive",
  jobC: "inactive",
  jobD: "inactive",
  jobE: "inactive"
});
assert.equal(cloudV4.state.roster.agents.length, 1);
assert.equal(cloudV4.state.roster.agents[0].job, "Solo");

await cloudV4.applyIdleCloudSettings({
  agentCount: 5,
  startSide: "E",
  jobA: "Lead",
  jobB: "Back",
  jobC: "Front",
  jobD: "Second viewpoint",
  jobE: "Auditor"
});
assert.equal(cloudV4.state.roster.agents.length, 5);
assert.equal(cloudV4.state.roster.agents[3].job, "Second viewpoint");
assert.equal(cloudV4.state.roster.agents[4].job, "Auditor");

console.log("dynamic-agent-semantics: ok");
