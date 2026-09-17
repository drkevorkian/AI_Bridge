import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capsSrc = fs.readFileSync(path.join(root, "agent-capabilities.js"), "utf8");
const runtimeSrc = fs.readFileSync(path.join(root, "viewpoint-runtime.js"), "utf8");
const queueUiSrc = fs.readFileSync(path.join(root, "dashboard-viewpoint-queue.js"), "utf8");

assert.match(runtimeSrc, /queueTelemetryReadOnly:\s*true/);
assert.match(runtimeSrc, /queueTelemetryEphemeral:\s*true/);
assert.match(runtimeSrc, /queueTelemetryContainsSensitiveIdentity:\s*false/);
assert.match(queueUiSrc, /aria-live/);
assert.match(queueUiSrc, /AI_BRIDGE_VIEWPOINT_QUEUE_STATUS/);
assert.doesNotMatch(queueUiSrc, /provenanceId|boundTabId|threadKey/);

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 1000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for queue state");
    await delay(2);
  }
}

function load(tabs, sendDelayMs = 15) {
  const listeners = [];
  const order = [];
  let activeSends = 0;
  let maxConcurrent = 0;
  const context = vm.createContext({
    URL, console, Object, Array, Number, String, Boolean, Set, Map, Promise, Error, Date,
    setTimeout, clearTimeout,
    SIDES: Object.keys(tabs),
    state: { transcript: [], nextSeq: 1 },
    tabForSide(side) { return tabs[side]?.id || 0; },
    requireExtensionPage(sender) {
      if (!String(sender?.url || "").startsWith("chrome-extension://bridge/")) {
        throw new Error("extension page only");
      }
    },
    chrome: {
      tabs: {
        async get(id) {
          const row = Object.values(tabs).find(item => item.id === id);
          if (!row) throw new Error("missing tab");
          return { id, url: row.url };
        }
      },
      runtime: {
        getURL(value = "") { return `chrome-extension://bridge/${value}`; },
        onMessage: { addListener(fn) { listeners.push(fn); } }
      }
    },
    recordTranscript(type, payload = {}) {
      const entry = { seq: context.state.nextSeq++, type, side: payload.side || null };
      context.state.transcript.push(entry);
      return entry;
    },
    async saveState() {},
    async sendToSide(side) {
      activeSends += 1;
      maxConcurrent = Math.max(maxConcurrent, activeSends);
      order.push(side);
      await delay(sendDelayMs);
      order.push(`done:${side}`);
      activeSends -= 1;
      return { ok: true, side };
    }
  });
  context.globalThis = context;
  vm.runInContext(capsSrc, context, { filename: "agent-capabilities.js" });
  context.__AI_BRIDGE_DYNAMIC_AGENTS_V1__ = Object.freeze({ version: 1, liveSides: () => Object.keys(tabs) });
  vm.runInContext(runtimeSrc, context, { filename: "viewpoint-runtime.js" });
  context.__tabs = tabs;
  context.__listeners = listeners;
  context.__order = order;
  context.__maxConcurrent = () => maxConcurrent;
  return context;
}

async function requestQueue(context, senderUrl = "chrome-extension://bridge/dashboard.html") {
  const listener = context.__listeners.find(fn => typeof fn === "function");
  assert.ok(listener, "queue-status runtime listener must be installed");
  return await new Promise((resolve, reject) => {
    const ret = listener({ type: "AI_BRIDGE_VIEWPOINT_QUEUE_STATUS" }, { url: senderUrl }, resolve);
    if (ret !== true) reject(new Error("queue listener must use async response contract"));
  });
}

const tabs = {
  A: { id: 11, url: "https://chatgpt.com/c/alpha" },
  D: { id: 44, url: "https://chatgpt.com/c/delta" },
  E: { id: 55, url: "https://chatgpt.com/c/echo" },
  B: { id: 22, url: "https://grok.com/chat/bravo" }
};
const ctx = load(tabs, 20);
const sends = [
  ctx.sendToSide("A", "a"),
  ctx.sendToSide("D", "d"),
  ctx.sendToSide("E", "e")
];
await waitFor(() => ctx.getViewpointQueueSnapshot().byFamily.chatgpt?.depth === 3);
const busy = ctx.getViewpointQueueSnapshot();
assert.equal(busy.byFamily.chatgpt.depth, 3);
assert.equal(busy.byFamily.chatgpt.waiting, 2);
assert.equal(busy.byFamily.chatgpt.active, true);
assert.equal(busy.byFamily.chatgpt.maxDepth, 3);
assert.equal(busy.bySide.A.phase, "sending");
assert.deepEqual(
  new Set([busy.bySide.D.queuePosition, busy.bySide.E.queuePosition]),
  new Set([1, 2])
);
const serializedBusy = JSON.stringify(busy);
assert.doesNotMatch(serializedBusy, /provenance|threadKey|boundTabId|https?:\/\//i,
  "queue telemetry must not expose sensitive conversation identity");

const dashboardResponse = await requestQueue(ctx);
assert.equal(dashboardResponse.ok, true);
assert.equal(dashboardResponse.queue.byFamily.chatgpt.depth, 3);
const denied = await requestQueue(ctx, "https://chatgpt.com/");
assert.equal(denied.ok, false);
assert.match(denied.error, /extension page/i);

await Promise.all(sends);
assert.equal(ctx.__maxConcurrent(), 1, "same-family queue must remain strictly serialized under telemetry");
let settled = ctx.getViewpointQueueSnapshot();
assert.equal(settled.byFamily.chatgpt.depth, 0);
assert.equal(settled.byFamily.chatgpt.totalEnqueued, 3);
assert.equal(settled.byFamily.chatgpt.totalCompleted, 3);
assert.equal(settled.byFamily.chatgpt.totalRejected, 0);
assert.ok(settled.byFamily.chatgpt.lastWaitMs > 0, "serialized queue should record a nonzero wait for later sends");
assert.ok(settled.byFamily.chatgpt.averageWaitMs > 0, "average wait should reflect serialized queueing");

const stress = [];
for (let i = 0; i < 18; i += 1) {
  const side = ["A", "D", "E"][i % 3];
  stress.push(ctx.sendToSide(side, `stress-${i}`));
}
await Promise.all(stress);
settled = ctx.getViewpointQueueSnapshot();
assert.equal(settled.byFamily.chatgpt.totalEnqueued, 21);
assert.equal(settled.byFamily.chatgpt.totalCompleted, 21);
assert.equal(settled.byFamily.chatgpt.totalRejected, 0);
assert.ok(settled.byFamily.chatgpt.maxDepth >= 3);
assert.equal(ctx.__maxConcurrent(), 1);

const raceTabs = {
  A: { id: 11, url: "https://chatgpt.com/c/one" },
  D: { id: 44, url: "https://chatgpt.com/c/two" },
  B: { id: 22, url: "https://grok.com/chat/b" }
};
const race = load(raceTabs, 30);
const first = race.sendToSide("A", "first");
const queued = race.sendToSide("D", "second");
await waitFor(() => race.getViewpointQueueSnapshot().bySide.D?.phase === "queued");
raceTabs.D.url = "https://chatgpt.com/c/navigated";
await first;
await assert.rejects(queued, /changed while queued/i);
let raceSnapshot = race.getViewpointQueueSnapshot();
assert.equal(raceSnapshot.byFamily.chatgpt.totalCompleted, 1);
assert.equal(raceSnapshot.byFamily.chatgpt.totalRejected, 1);
assert.equal(raceSnapshot.byFamily.chatgpt.depth, 0);
assert.equal(race.state.viewpointIdentityBySide?.D, undefined,
  "rejected queued send must not publish stale provenance");

// A rejected queued send must not poison the family queue. After the user binds
// D to a stable replacement thread, the next send should dispatch normally and
// telemetry should recover to idle with a second successful completion.
raceTabs.D.url = "https://chatgpt.com/c/recovered";
await race.sendToSide("D", "third");
raceSnapshot = race.getViewpointQueueSnapshot();
assert.equal(raceSnapshot.byFamily.chatgpt.totalCompleted, 2);
assert.equal(raceSnapshot.byFamily.chatgpt.totalRejected, 1);
assert.equal(raceSnapshot.byFamily.chatgpt.depth, 0);
assert.equal(race.__order.at(-2), "D");
assert.equal(race.__order.at(-1), "done:D");
assert.equal(race.state.viewpointIdentityBySide.D.threadKey, "https://chatgpt.com/c/recovered");

console.log("viewpoint-queue-observability: ok");
