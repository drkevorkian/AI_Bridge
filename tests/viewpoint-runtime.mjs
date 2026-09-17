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
assert.match(runtimeSrc, /enablesDuplicateProviders:\s*true/);
assert.match(runtimeSrc, /validatesBindingsBeforeSend:\s*true/);
assert.match(runtimeSrc, /revalidatesIdentityAtDispatch:\s*true/);
assert.match(runtimeSrc, /stampsBeforeCommitSave:\s*true/);
assert.match(runtimeSrc, /capturesIdentityBeforeDispatch:\s*true/);
assert.match(runtimeSrc, /failsClosedWithoutDispatchIdentityWhenEnabled:\s*true/);
assert.match(wrapper, /revalidatesIdentityAtDispatch\s*!==\s*true/);

function load(tabs) {
  const order = [];
  const savedSnapshots = [];
  const context = vm.createContext({
    URL, console, Object, Array, Number, String, Boolean, Set, Map, Promise, Error,
    setTimeout,
    SIDES: Object.keys(tabs),
    state: { transcript: [], nextSeq: 1 },
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
    recordTranscript(type, payload = {}) {
      const entry = {
        seq: context.state.nextSeq++,
        type,
        side: payload.side || null,
        text: String(payload.text || "")
      };
      context.state.transcript.push(entry);
      return entry;
    },
    async saveState() {
      savedSnapshots.push(JSON.parse(JSON.stringify(context.state)));
    },
    async handleCompletedResponse(side, text) {
      context.recordTranscript("response", { side, text });
      await context.saveState();
      return { ok: true };
    },
    async sendToSide(side, text, options) {
      order.push(side);
      await new Promise(resolve => setTimeout(resolve, side === "A" ? 20 : 5));
      order.push(`done:${side}`);
      if (options?.record !== false) await context.saveState();
      return { ok: true, side, text };
    }
  });
  context.globalThis = context;
  vm.runInContext(capsSrc, context, { filename: "agent-capabilities.js" });
  context.__AI_BRIDGE_DYNAMIC_AGENTS_V1__ = Object.freeze({
    version: 1,
    liveSides: () => Object.keys(tabs)
  });
  vm.runInContext(runtimeSrc, context, { filename: "viewpoint-runtime.js" });
  context.__order = order;
  context.__savedSnapshots = savedSnapshots;
  context.__tabs = tabs;
  return context;
}

const ctx = load({
  A: { id: 11, url: "https://chatgpt.com/c/one?utm=1#fragment" },
  B: { id: 22, url: "https://grok.com/chat/two" },
  C: { id: 33, url: "https://claude.ai/chat/three" }
});

assert.equal(ctx.__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__.enablesDuplicateProviders, true);
assert.equal(ctx.__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__.failsClosedWithoutDispatchIdentityWhenEnabled, true);
assert.equal(ctx.__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__.validatesBindingsBeforeSend, true);
assert.equal(ctx.__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__.revalidatesIdentityAtDispatch, true);
assert.equal(ctx.__AI_BRIDGE_AGENT_CAPABILITIES__.duplicateProviderAgentsEnabled, true);
assert.throws(() => ctx.requireViewpointDispatchIdentity(null), /trusted conversation identity/i);

await ctx.sendToSide("A", "hello");
ctx.__tabs.A.url = "https://chatgpt.com/c/navigated-away";
await ctx.handleCompletedResponse("A", "first answer");

const stamped = ctx.state.transcript[0];
assert.equal(stamped.providerFamily, "chatgpt");
assert.equal(stamped.threadKey, "https://chatgpt.com/c/one");
assert.match(stamped.provenanceId, /chatgpt:tab:11:https:\/\/chatgpt.com\/c\/one/);
assert.equal(stamped.boundTabId, 11);

const persistedResponse = ctx.__savedSnapshots.at(-1).transcript[0];
assert.equal(persistedResponse.threadKey, "https://chatgpt.com/c/one",
  "provenance must be present in the same persisted response commit");
assert.equal(persistedResponse.boundTabId, 11);

const beforeResendSaves = ctx.__savedSnapshots.length;
ctx.__tabs.B.url = "https://grok.com/chat/two?tracking=drop-me";
await ctx.sendToSide("B", "retry", { record: false });
assert.ok(ctx.__savedSnapshots.length > beforeResendSaves);
assert.equal(ctx.state.viewpointIdentityBySide.B.threadKey, "https://grok.com/chat/two");

const sameFamily = load({
  A: { id: 11, url: "https://chatgpt.com/c/one" },
  D: { id: 44, url: "https://chatgpt.com/c/two" },
  B: { id: 22, url: "https://grok.com/" }
});
const first = sameFamily.sendToSide("A", "one");
const second = sameFamily.sendToSide("D", "two");
await Promise.all([first, second]);
assert.deepEqual(sameFamily.__order, ["A", "done:A", "D", "done:D"], "same-family sends must not overlap");

const navigatedWhileQueued = load({
  A: { id: 11, url: "https://chatgpt.com/c/one" },
  D: { id: 44, url: "https://chatgpt.com/c/two" },
  B: { id: 22, url: "https://grok.com/" }
});
const blockingSend = navigatedWhileQueued.sendToSide("A", "hold queue");
const queuedSend = navigatedWhileQueued.sendToSide("D", "must not cross threads");
// Allow both wrappers to snapshot their intended identities and enqueue D behind A.
await new Promise(resolve => setTimeout(resolve, 1));
navigatedWhileQueued.__tabs.D.url = "https://chatgpt.com/c/changed-while-queued";
await blockingSend;
await assert.rejects(() => queuedSend, /binding changed while queued|preserve conversation provenance/i);
assert.deepEqual(navigatedWhileQueued.__order, ["A", "done:A"],
  "a queued send must not reach the provider after its tab/thread identity changes");
assert.equal(navigatedWhileQueued.state.viewpointIdentityBySide?.D, undefined,
  "rejected queued sends must not publish stale provenance into coordinator state");

const duplicateThread = load({
  A: { id: 11, url: "https://chatgpt.com/c/shared?x=1" },
  D: { id: 44, url: "https://chatgpt.com/c/shared#frag" },
  B: { id: 22, url: "https://grok.com/" }
});
await assert.rejects(() => duplicateThread.sendToSide("A", "blocked"), /distinct conversation threads|share chatgpt::https:\/\/chatgpt\.com\/c\/shared/i);
assert.deepEqual(duplicateThread.__order, [], "binding conflicts must be rejected before provider dispatch");

console.log("viewpoint-runtime: ok");
