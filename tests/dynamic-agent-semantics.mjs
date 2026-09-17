import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");
const capsSrc = fs.readFileSync(path.join(root, "agent-capabilities.js"), "utf8");
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
    requireBoundSessionTab() {
      throw new Error("Artifact fetch is only allowed from a currently bound AI A/B/C tab.");
    },
    forceRelayCapturedResponse: async () => ({ ok: true }),
    sanitizeCloudSettings(raw) {
      const src = raw || {};
      return {
        startSide: ["A", "B", "C"].includes(src.startSide) ? src.startSide : "A",
        jobA: String(src.jobA || ""),
        jobB: String(src.jobB || ""),
        jobC: String(src.jobC || "")
      };
    },
    applyIdleCloudSettings: async function applyIdle(settings) {
      context.state.jobA = settings.jobA;
      context.state.jobB = settings.jobB;
      context.state.jobC = settings.jobC;
      context.state.startSide = settings.startSide;
    }
  });
  context.globalThis = context;
  context.__AI_BRIDGE_AGENT_CAPABILITIES__ = caps;
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

const cloud = load(3);
const stored = cloud.sanitizeCloudSettings({
  agentCount: 5,
  startSide: "E",
  jobA: "Lead",
  jobD: "Second viewpoint",
  jobE: "Auditor"
});
assert.equal(stored.agentCount, 5);
assert.equal(stored.startSide, "E");
assert.equal(stored.jobD, "Second viewpoint");
assert.equal(stored.jobE, "Auditor");
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
console.log("dynamic-agent-semantics: ok");
