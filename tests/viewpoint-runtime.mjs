import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");
const capsSrc = fs.readFileSync(path.join(root, "agent-capabilities.js"), "utf8");
const runtimeSrc = fs.readFileSync(path.join(root, "viewpoint-runtime.js"), "utf8");

assert.ok(wrapper.includes('importScripts("viewpoint-runtime.js")'));
assert.match(runtimeSrc, /enablesDuplicateProviders:\s*false/);
assert.doesNotMatch(runtimeSrc, /duplicateProviderAgentsEnabled\s*=\s*true/);

function load(tabs) {
  const order = [];
  const context = vm.createContext({
    URL, console, Object, Array, Number, String, Boolean, Set, Map, Promise, Error,
    SIDES: ["A", "B", "C"],
    state: { transcript: [] },
    tabForSide(side) {
      return tabs[side]?.id || 0;
    },
    chrome: {
      tabs: {
        async get(id) {
          const row = Object.values(tabs).find(item => item.id === id);
          if (!row) throw new Error("missing tab");
          return { id, url: row.url };
        }
      }
    },
    async handleCompletedResponse(side, text) {
      const entry = { type: "response", side, text, seq: context.state.transcript.length + 1 };
      context.state.transcript.push(entry);
      return { ok: true };
    },
    async sendToSide(side, text) {
      order.push(side);
      await new Promise(resolve => setTimeout(resolve, side === "A" ? 20 : 5));
      order.push(`done:${side}`);
      return { ok: true, side, text };
    }
  });
  context.globalThis = context;
  vm.runInContext(capsSrc, context, { filename: "agent-capabilities.js" });
  context.__AI_BRIDGE_DYNAMIC_AGENTS_V1__ = Object.freeze({
    version: 1,
    liveSides: () => ["A", "B", "C"]
  });
  vm.runInContext(runtimeSrc, context, { filename: "viewpoint-runtime.js" });
  context.__order = order;
  return context;
}

const ctx = load({
  A: { id: 11, url: "https://chatgpt.com/c/one?utm=1" },
  B: { id: 22, url: "https://grok.com/chat/two" },
  C: { id: 33, url: "https://claude.ai/chat/three" }
});

assert.equal(ctx.__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__.enablesDuplicateProviders, false);
assert.equal(ctx.__AI_BRIDGE_AGENT_CAPABILITIES__.duplicateProviderAgentsEnabled, false);

await ctx.handleCompletedResponse("A", "first answer");
const stamped = ctx.state.transcript[0];
assert.equal(stamped.providerFamily, "chatgpt");
assert.equal(stamped.threadKey, "https://chatgpt.com/c/one");
assert.match(stamped.provenanceId, /chatgpt:tab:11:https:\/\/chatgpt.com\/c\/one/);
assert.equal(stamped.boundTabId, 11);

await ctx.sendToSide("A", "hello");
await ctx.sendToSide("B", "hello");
assert.deepEqual(ctx.__order, ["A", "done:A", "B", "done:B"]);

const sameFamily = load({
  A: { id: 11, url: "https://chatgpt.com/c/one" },
  B: { id: 22, url: "https://chatgpt.com/c/two" },
  C: { id: 33, url: "https://grok.com/" }
});
const first = sameFamily.sendToSide("A", "one");
const second = sameFamily.sendToSide("B", "two");
await Promise.all([first, second]);
assert.deepEqual(sameFamily.__order, ["A", "done:A", "B", "done:B"], "same-family sends must not overlap");

console.log("viewpoint-runtime: ok");
