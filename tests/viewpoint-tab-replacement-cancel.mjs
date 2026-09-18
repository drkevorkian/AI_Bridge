import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capsSrc = fs.readFileSync(path.join(root, "agent-capabilities.js"), "utf8");
const rosterSrc = fs.readFileSync(path.join(root, "roster-state-adapter.js"), "utf8");
const runtimeSrc = fs.readFileSync(path.join(root, "viewpoint-runtime.js"), "utf8");
const wrapperSrc = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

assert.match(runtimeSrc, /cancelsQueuedOnTabReplace:\s*true/,
  "viewpoint runtime must advertise immediate cancellation when Chrome replaces a queued target tab");
assert.match(runtimeSrc, /chrome\?\.tabs\?\.onReplaced\?\.addListener/,
  "viewpoint runtime must subscribe to tabs.onReplaced");
assert.match(runtimeSrc, /cancelQueuedForTab\(removedTabId,\s*"replaced"\)/,
  "replacement cancellation must use the retired tab id, never the replacement id");
assert.match(wrapperSrc, /__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__\?\.cancelsQueuedOnTabReplace\s*!==\s*true/,
  "service-worker bootstrap must fail closed if tab-replacement queue cancellation is missing");

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 1000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for queued viewpoint send");
    await delay(2);
  }
}

const tabs = {
  A: { id: 101, url: "https://chatgpt.com/c/active" },
  D: { id: 404, url: "https://chatgpt.com/c/queued" },
  B: { id: 202, url: "https://grok.com/chat/bravo" }
};
const replacedListeners = [];
const order = [];

const context = vm.createContext({
  URL, console, Object, Array, Number, String, Boolean, Set, Map, Promise, Error, Date,
  setTimeout, clearTimeout,
  SIDES: Object.keys(tabs),
  state: { transcript: [], nextSeq: 1, tabA: 101, tabD: 404, tabB: 202 },
  tabForSide(side) { return tabs[side]?.id || 0; },
  chrome: {
    tabs: {
      async get(id) {
        const row = Object.values(tabs).find(item => item.id === id);
        if (!row) throw new Error("missing tab");
        return { id, url: row.url };
      },
      onRemoved: { addListener() {} },
      onReplaced: { addListener(fn) { replacedListeners.push(fn); } }
    },
    runtime: {
      getURL(value = "") { return `chrome-extension://bridge/${value}`; },
      onMessage: { addListener() {} }
    }
  },
  recordTranscript(type, payload = {}) {
    const entry = { seq: context.state.nextSeq++, type, side: payload.side || null };
    context.state.transcript.push(entry);
    return entry;
  },
  async saveState() {},
  async sendToSide(side) {
    order.push(side);
    await delay(60);
    order.push(`done:${side}`);
    return { ok: true, side };
  }
});
context.globalThis = context;
vm.runInContext(capsSrc, context, { filename: "agent-capabilities.js" });
vm.runInContext(rosterSrc, context, { filename: "roster-state-adapter.js" });
context.__AI_BRIDGE_DYNAMIC_AGENTS_V1__ = Object.freeze({ version: 1, liveSides: () => Object.keys(tabs) });
vm.runInContext(runtimeSrc, context, { filename: "viewpoint-runtime.js" });

assert.equal(replacedListeners.length, 1, "runtime must install exactly one tab-replacement listener");

const active = context.sendToSide("A", "hold-family-lock");
const queued = context.sendToSide("D", "must-never-dispatch");
await waitFor(() => context.getViewpointQueueSnapshot().bySide.D?.phase === "queued");

// Chrome may retire one tab ID and supply another through onReplaced. AI Bridge
// must not silently transfer logical-agent trust to the browser-created ID.
// Cancel work tied to the retired ID immediately and let explicit rebinding own
// any later use of the replacement tab.
for (const listener of replacedListeners) listener(405, 404);

await assert.rejects(queued, /target tab replaced while queued/i);
const immediate = context.getViewpointQueueSnapshot();
assert.equal(immediate.byFamily.chatgpt.waiting, 0,
  "replaced queued tab must disappear from queue telemetry immediately");
assert.equal(immediate.byFamily.chatgpt.totalRejected, 1,
  "replacement cancellation must count exactly one rejection");
assert.equal(immediate.bySide.D, undefined);
assert.equal(order.includes("D"), false,
  "a queued send targeting the retired tab id must never reach provider dispatch");

await active;
await delay(5);
const settled = context.getViewpointQueueSnapshot();
assert.equal(settled.byFamily.chatgpt.depth, 0);
assert.equal(settled.byFamily.chatgpt.totalCompleted, 1);
assert.equal(settled.byFamily.chatgpt.totalRejected, 1,
  "the serialized chain must skip the cancelled entry without double-counting it");
assert.equal(order.includes("D"), false);

console.log("viewpoint-tab-replacement-cancel: ok");
