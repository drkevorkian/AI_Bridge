import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capsSrc = fs.readFileSync(path.join(root, "agent-capabilities.js"), "utf8");
const adapterSrc = fs.readFileSync(path.join(root, "execution-key-adapter.js"), "utf8");

const context = vm.createContext({ URL, console, Object, Array, Number, String, Boolean, Set, Map, Promise, RangeError, TypeError, Error });
context.globalThis = context;
vm.runInContext(capsSrc, context, { filename: "agent-capabilities.js" });
vm.runInContext(adapterSrc, context, { filename: "execution-key-adapter.js" });

const adapter = context.__AI_BRIDGE_EXECUTION_KEY_ADAPTER_V1__;
assert.ok(adapter);
assert.equal(adapter.version, 1);
assert.equal(adapter.persistsSecondExecutionMapRepresentation, false);
assert.equal(adapter.legacyExecutionKeyCompatibility, true);
assert.equal(adapter.canonicalFPlusFailsClosedUntilRosterV2Cutover, true);

assert.equal(adapter.executionKeyForAgentRef("A"), "A");
assert.equal(adapter.executionKeyForAgentRef("e"), "E");
assert.equal(adapter.executionKeyForAgentRef("agent-1"), "A");
assert.equal(adapter.executionKeyForAgentRef("agent-5"), "E");
assert.equal(adapter.canonicalAgentIdForExecutionKey("A"), "agent-1");
assert.equal(adapter.canonicalAgentIdForExecutionKey("E"), "agent-5");

assert.throws(
  () => adapter.executionKeyForAgentRef("agent-6"),
  error => error?.name === "RangeError" && /not representable/.test(String(error?.message || ""))
);
for (const bad of ["", "F", "__proto__", "constructor", "agent-0", "agent-01"]) {
  assert.throws(() => adapter.executionKeyForAgentRef(bad));
}

const state = {
  generationIdBySide: { A: "gen-a" },
  viewpointIdentityBySide: { B: { threadKey: "/c/b" } }
};

assert.equal(adapter.read(state, "generationIdBySide", "agent-1", null), "gen-a");
adapter.write(state, "generationIdBySide", "agent-2", "gen-b");
assert.equal(state.generationIdBySide.B, "gen-b");
assert.equal(adapter.read(state, "generationIdBySide", "B", null), "gen-b");

adapter.write(state, "viewpointIdentityBySide", "agent-3", { threadKey: "/c/c" });
assert.equal(state.viewpointIdentityBySide.C.threadKey, "/c/c");
assert.equal(adapter.has(state, "viewpointIdentityBySide", "agent-3"), true);
assert.equal(adapter.remove(state, "viewpointIdentityBySide", "C"), true);
assert.equal(adapter.has(state, "viewpointIdentityBySide", "agent-3"), false);

assert.throws(
  () => adapter.read(state, "__proto__", "A"),
  error => error?.name === "RangeError" && /Unknown execution-state map/.test(String(error?.message || ""))
);
assert.throws(() => adapter.write(state, "constructor", "A", "x"));
assert.throws(() => adapter.remove(state, "prototype", "A"));

assert.equal(Array.isArray(adapter.allowedMaps), true);
assert.equal(adapter.allowedMaps.includes("generationIdBySide"), true);
assert.equal(adapter.allowedMaps.includes("viewpointIdentityBySide"), true);

console.log("execution-key-adapter: canonical-to-legacy execution translation ok");
