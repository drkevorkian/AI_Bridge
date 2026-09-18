import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capsSrc = fs.readFileSync(path.join(root, "agent-capabilities.js"), "utf8");
const cloudSrc = fs.readFileSync(path.join(root, "cloud-settings-v2.js"), "utf8");

const context = vm.createContext({
  URL, console, Object, Array, Number, String, Boolean, Set, Map, Promise, RangeError, TypeError, Error
});
context.globalThis = context;
vm.runInContext(capsSrc, context, { filename: "agent-capabilities.js" });
vm.runInContext(cloudSrc, context, { filename: "cloud-settings-v2.js" });

const api = context.__AI_BRIDGE_CLOUD_SETTINGS_V2__;
assert.ok(api);
assert.equal(api.version, 2);
assert.equal(api.importsSchemaV1, true);
assert.equal(api.emitsSchemaV2Only, true);
assert.equal(api.persistsTabBindings, false);
assert.equal(api.canonicalRosterAuthority, true);

const fromV1 = api.normalizeRosterAndStart({
  schemaVersion: 1,
  agentCount: 5,
  startSide: "E",
  jobA: "Lead",
  jobB: "Backend",
  jobC: "Frontend",
  jobD: "Second viewpoint",
  jobE: "Audit",
  tabA: 101,
  tabE: 505
});
assert.equal(fromV1.roster.version, 2);
assert.equal(fromV1.roster.agents.length, 5);
assert.equal(fromV1.roster.nextOrdinal, 6);
assert.equal(fromV1.startAgentId, "agent-5");
assert.equal(fromV1.roster.agents[3].id, "agent-4");
assert.equal(fromV1.roster.agents[3].job, "Second viewpoint");
assert.equal(Object.prototype.hasOwnProperty.call(fromV1.roster.agents[0], "tabId"), false,
  "cloud roster must never include browser tab bindings");

const v2 = api.normalizeRosterAndStart({
  schemaVersion: 2,
  startAgentId: "agent-4",
  roster: {
    version: 2,
    nextOrdinal: 5,
    agents: [
      { id: "agent-1", ordinal: 1, label: "Lead", job: "A" },
      { id: "agent-2", ordinal: 2, label: "Back", job: "B" },
      { id: "agent-3", ordinal: 3, label: "Front", job: "C" },
      { id: "agent-4", ordinal: 4, label: "Second", job: "D" }
    ]
  }
});
assert.equal(v2.startAgentId, "agent-4");
assert.equal(v2.roster.agents[0].label, "Lead");
assert.equal(v2.roster.agents[3].job, "D");

const projected = api.projectToLegacy({
  schemaVersion: 2,
  startAgentId: v2.startAgentId,
  roster: v2.roster
});
assert.equal(projected.agentCount, 4);
assert.equal(projected.startSide, "D");
assert.equal(projected.jobA, "A");
assert.equal(projected.jobD, "D");
assert.equal(projected.jobE, "");

assert.throws(
  () => api.normalizeRosterAndStart({
    schemaVersion: 2,
    startAgentId: "agent-6",
    roster: v2.roster
  }),
  /outside the active roster/i
);
assert.throws(
  () => api.normalizeRosterAndStart({
    schemaVersion: 2,
    startAgentId: "agent-1",
    roster: {
      version: 2,
      nextOrdinal: 3,
      agents: [
        { id: "agent-1", ordinal: 1, job: "" },
        { id: "agent-3", ordinal: 2, job: "" }
      ]
    }
  }),
  /ID does not match|ordinal/i
);
assert.throws(
  () => api.normalizeRosterAndStart({
    schemaVersion: 2,
    startAgentId: "agent-1",
    roster: {
      version: 2,
      nextOrdinal: 7,
      agents: Array.from({ length: 6 }, (_, index) => ({
        id: `agent-${index + 1}`,
        ordinal: index + 1,
        job: ""
      }))
    }
  }),
  /1 to 5 active agents|ceiling/i
);

assert.doesNotMatch(cloudSrc, /tabId|chrome\.tabs|chrome\.storage/,
  "cloud schema contract must not know browser tab bindings or storage APIs");

console.log("cloud-settings-v2: canonical roster + V1 import compatibility ok");
