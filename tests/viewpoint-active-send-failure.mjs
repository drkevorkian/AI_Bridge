import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capsSrc = fs.readFileSync(path.join(root, "agent-capabilities.js"), "utf8");
const rosterSrc = fs.readFileSync(path.join(root, "roster-state-adapter.js"), "utf8");
const executionSrc = fs.readFileSync(path.join(root, "execution-key-adapter.js"), "utf8");
const runtimeSrc = fs.readFileSync(path.join(root, "viewpoint-runtime.js"), "utf8");

assert.match(runtimeSrc, /clearsTransientIdentityOnDispatchFailure:\s*true/);

const tabs = {
  A: { id: 11, url: "https://chatgpt.com/c/active-fail" },
  D: { id: 44, url: "https://chatgpt.com/c/recovery" }
};
const order = [];
let failA = true;

const context = vm.createContext({
  URL, console, Object, Array, Number, String, Boolean, Set, Map, Promise, Error, Date,
  setTimeout, clearTimeout,
  SIDES: ["A", "D"],
  state: {
    transcript: [],
    nextSeq: 1,
    tabA: 11,
    tabD: 44,
    generationIdBySide: { A: null, D: null }
  },
  tabForSide(side) { return tabs[side]?.id || 0; },
  requireExtensionPage() {},
  chrome: {
    tabs: {
      async get(id) {
        const row = Object.values(tabs).find(item => item.id === id);
        if (!row) throw new Error("missing tab");
        return { id, url: row.url };
      },
      onRemoved: { addListener() {} }
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
    context.state.generationIdBySide = {
      ...(context.state.generationIdBySide || {}),
      [side]: `generation-${side}`
    };
    order.push(`start:${side}`);
    if (side === "A" && failA) {
      failA = false;
      order.push("fail:A");
      throw new Error("provider content script disconnected");
    }
    order.push(`done:${side}`);
    return { ok: true, side };
  }
});
context.globalThis = context;
vm.runInContext(capsSrc, context, { filename: "agent-capabilities.js" });
vm.runInContext(executionSrc, context, { filename: "execution-key-adapter.js" });
vm.runInContext(rosterSrc, context, { filename: "roster-state-adapter.js" });
context.__AI_BRIDGE_DYNAMIC_AGENTS_V1__ = Object.freeze({ version: 1, liveSides: () => ["A", "D"] });
vm.runInContext(runtimeSrc, context, { filename: "viewpoint-runtime.js" });

await assert.rejects(
  context.sendToSide("A", "will fail"),
  /content script disconnected/i
);

assert.equal(context.state.viewpointIdentityBySide?.A, undefined,
  "failed active dispatch must clear transient viewpoint identity");
assert.equal(context.state.generationIdBySide.A, null,
  "failed active dispatch must disarm the generation id");

// A later response-like transcript write must not inherit provenance from the
// failed send after the side has been disarmed.
const stray = context.recordTranscript("response", { side: "A" });
assert.equal(stray.provenanceId, undefined);
assert.equal(stray.threadKey, undefined);

// The family queue must remain usable after an active-send failure.
await context.sendToSide("D", "recovery send");
assert.equal(context.state.viewpointIdentityBySide.D.threadKey, "https://chatgpt.com/c/recovery");
assert.equal(context.state.generationIdBySide.D, "generation-D");
assert.deepEqual(order, ["start:A", "fail:A", "start:D", "done:D"]);

console.log("viewpoint-active-send-failure: ok");
