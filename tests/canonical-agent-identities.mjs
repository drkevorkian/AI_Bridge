import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "agent-capabilities.js"), "utf8");

const context = vm.createContext({ URL, console });
context.globalThis = context;
vm.runInContext(source, context, { filename: "agent-capabilities.js" });

const caps = context.__AI_BRIDGE_AGENT_CAPABILITIES__;
assert.ok(caps);
assert.equal(caps.stableMachineAgentIds, true);
assert.equal(caps.canonicalAgentIdVersion, 1);
assert.equal(caps.legacyAliasLimit, 5);

// Canonical IDs are deliberately not capped by the current five-agent runtime
// policy. Identity format must remain usable when a later slice enables F+.
assert.equal(caps.agentIdForOrdinal(1), "agent-1");
assert.equal(caps.agentIdForOrdinal(5), "agent-5");
assert.equal(caps.agentIdForOrdinal(6), "agent-6");
assert.equal(caps.agentIdForOrdinal(27), "agent-27");
assert.equal(caps.agentIdForOrdinal(Number.MAX_SAFE_INTEGER), `agent-${Number.MAX_SAFE_INTEGER}`);

for (const bad of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "abc", null, undefined]) {
  assert.throws(
    () => caps.agentIdForOrdinal(bad),
    error => error?.name === "RangeError" && /positive safe integer/.test(String(error?.message || "")),
    `invalid ordinal should fail closed: ${String(bad)}`
  );
}

assert.equal(caps.ordinalForAgentId("agent-1"), 1);
assert.equal(caps.ordinalForAgentId("agent-5"), 5);
assert.equal(caps.ordinalForAgentId("agent-6"), 6);
assert.equal(caps.ordinalForAgentId("agent-27"), 27);
assert.equal(caps.ordinalForAgentId(`agent-${Number.MAX_SAFE_INTEGER}`), Number.MAX_SAFE_INTEGER);

for (const bad of [
  "", "agent-0", "agent--1", "agent-01", "agent-1.0", "Agent-1", "AGENT-1",
  "agent-1-extra", "__proto__", "constructor", "prototype", {}, [], 1,
  `agent-${Number.MAX_SAFE_INTEGER}0`
]) {
  assert.equal(caps.ordinalForAgentId(bad), null, `invalid canonical ID should fail closed: ${String(bad)}`);
  assert.equal(caps.isCanonicalAgentId(bad), false);
}

assert.equal(caps.isCanonicalAgentId("agent-1"), true);
assert.equal(caps.isCanonicalAgentId("agent-999"), true);

assert.equal(caps.legacySideForOrdinal(1), "A");
assert.equal(caps.legacySideForOrdinal(5), "E");
assert.equal(caps.legacySideForOrdinal(6), null);
assert.equal(caps.legacySideForOrdinal(27), null);
assert.equal(caps.ordinalForLegacySide("A"), 1);
assert.equal(caps.ordinalForLegacySide("e"), 5);
for (const bad of ["F", "AA", "", "__proto__", "constructor", 1, null]) {
  assert.equal(caps.ordinalForLegacySide(bad), null);
}

// Slice 75 must not raise runtime capacity or mutate legacy side support.
assert.equal(caps.maxLogicalAgents, 5);
assert.deepEqual(Array.from(caps.supportedAgentSides), ["A", "B", "C", "D", "E"]);
assert.equal(caps.parseAgentCount(6), null);

console.log("canonical-agent-identities: ok");
