import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const capsSrc = fs.readFileSync(path.join(root, "agent-capabilities.js"), "utf8");
const rosterSrc = fs.readFileSync(path.join(root, "roster-state-adapter.js"), "utf8");
const viewpointSrc = fs.readFileSync(path.join(root, "viewpoint-runtime.js"), "utf8");
const resendSrc = fs.readFileSync(path.join(root, "resend-runtime-hardening.js"), "utf8");
const generationSrc = fs.readFileSync(path.join(root, "coordinator-generation-hardening.js"), "utf8");

// The RESEND command must remain side-scoped before it reaches the hardened
// send stack. It may move coordinator turn ownership to the selected side, but
// it must not clear another logical agent's last response or send state.
assert.match(background, /const side = String\(msg\.side \|\| ""\)\.toUpperCase\(\)/);
assert.match(background, /const text = state\.lastSentBySide\[side\]/);
assert.match(background, /delete state\.lastResponseBySide\[side\]/);
assert.match(background, /await sendToSide\(side, text, \{ record: false, artifactIds, artifacts \}\)/);

// Resend hardening must address the selected side's provider tab, not a whole
// provider family. The viewpoint runtime remains the only family-level queue.
assert.match(resendSrc, /const tabId = Number\(tabForSide\(side\)\)/);
assert.match(resendSrc, /await stopActiveGeneration\(side\)/);
assert.match(resendSrc, /return baseSendToSide\(side, text, options\)/);
assert.doesNotMatch(resendSrc, /providerFamily|familyQueues|viewpointIdentityBySide/);

const tabs = {
  A: { id: 11, url: "https://chatgpt.com/c/a" },
  D: { id: 44, url: "https://chatgpt.com/c/d" },
  E: { id: 55, url: "https://chatgpt.com/c/e" }
};
const generating = new Map([[11, true], [44, false], [55, false]]);
const stopRequests = [];
const dispatchOrder = [];
let activeDispatches = 0;
let maxActiveDispatches = 0;
let generationCounter = 1;

const context = vm.createContext({
  URL, console, Object, Array, Number, String, Boolean, Set, Map, Promise, Error,
  Date, Math, setTimeout, clearTimeout,
  SIDES: ["A", "D", "E"],
  state: {
    transcript: [],
    nextSeq: 1,
    tabA: 11,
    tabD: 44,
    tabE: 55,
    generationIdBySide: { A: "A-old", D: "D-current", E: "E-current" },
    viewpointIdentityBySide: {
      D: {
        provenanceId: "chatgpt:tab:44:https://chatgpt.com/c/d",
        threadKey: "https://chatgpt.com/c/d",
        providerFamily: "chatgpt",
        boundTabId: 44
      },
      E: {
        provenanceId: "chatgpt:tab:55:https://chatgpt.com/c/e",
        threadKey: "https://chatgpt.com/c/e",
        providerFamily: "chatgpt",
        boundTabId: 55
      }
    }
  },
  tabForSide(side) {
    return tabs[side]?.id || 0;
  },
  async ensureTabListener() {
    return true;
  },
  async saveState() {},
  recordTranscript(type, payload = {}) {
    const entry = { seq: context.state.nextSeq++, type, side: payload.side || null, text: String(payload.text || "") };
    context.state.transcript.push(entry);
    return entry;
  },
  chrome: {
    tabs: {
      async get(id) {
        const row = Object.values(tabs).find(item => item.id === id);
        if (!row) throw new Error("missing tab");
        return { id, url: row.url };
      },
      async sendMessage(id, message) {
        if (message?.type === "AI_BRIDGE_GENERATION_STATUS") {
          return { ok: true, generating: generating.get(Number(id)) === true };
        }
        if (message?.type === "AI_BRIDGE_STOP_GENERATION") {
          stopRequests.push(Number(id));
          const wasGenerating = generating.get(Number(id)) === true;
          generating.set(Number(id), false);
          return { ok: true, stopped: wasGenerating };
        }
        return { ok: true };
      },
      onRemoved: { addListener() {} }
    },
    runtime: { onMessage: { addListener() {} }, getURL: () => "chrome-extension://bridge/" }
  },
  async sendToSide(side, text) {
    activeDispatches += 1;
    maxActiveDispatches = Math.max(maxActiveDispatches, activeDispatches);
    dispatchOrder.push(`start:${side}`);
    const generationId = `${side}-new-${generationCounter++}`;
    context.state.generationIdBySide = { ...context.state.generationIdBySide, [side]: generationId };
    await new Promise(resolve => setTimeout(resolve, 8));
    dispatchOrder.push(`done:${side}`);
    activeDispatches -= 1;
    return { ok: true, side, text, generationId };
  }
});
context.globalThis = context;

vm.runInContext(capsSrc, context, { filename: "agent-capabilities.js" });
vm.runInContext(rosterSrc, context, { filename: "roster-state-adapter.js" });
context.__AI_BRIDGE_DYNAMIC_AGENTS_V1__ = Object.freeze({
  version: 1,
  liveSides: () => ["A", "D", "E"]
});
vm.runInContext(viewpointSrc, context, { filename: "viewpoint-runtime.js" });
vm.runInContext(resendSrc, context, { filename: "resend-runtime-hardening.js" });
vm.runInContext(generationSrc, context, { filename: "coordinator-generation-hardening.js" });

const dGenerationBefore = context.state.generationIdBySide.D;
const eGenerationBefore = context.state.generationIdBySide.E;
const dIdentityBefore = JSON.parse(JSON.stringify(context.state.viewpointIdentityBySide.D));
const eIdentityBefore = JSON.parse(JSON.stringify(context.state.viewpointIdentityBySide.E));

// Replacement of A and a contemporaneous D send share one provider-family
// queue. They may execute in either order depending on A's stop handshake, but
// the provider-facing send calls must never overlap.
const resendA = context.sendToSide("A", "replace A", { record: false });
const sendD = context.sendToSide("D", "continue D", { record: false });
const [aResult, dResult] = await Promise.all([resendA, sendD]);

assert.equal(maxActiveDispatches, 1, "same-provider replacement/send calls must stay serialized");
assert.ok(stopRequests.includes(11), "resending A must inspect/stop A's provider tab");
assert.ok(!stopRequests.includes(44), "A replacement must not stop D's independent provider tab");
assert.ok(!stopRequests.includes(55), "A replacement must not stop E's independent provider tab");
assert.match(aResult.generationId, /^A-new-/);
assert.match(dResult.generationId, /^D-new-/);

// A replacement must not mutate E at all, and D's new send may only replace D's
// own generation/identity. No provider-family-wide generation reset is allowed.
assert.equal(context.state.generationIdBySide.E, eGenerationBefore);
assert.deepEqual(context.state.viewpointIdentityBySide.E, eIdentityBefore);
assert.notEqual(context.state.generationIdBySide.A, "A-old");
assert.notEqual(context.state.generationIdBySide.D, dGenerationBefore);
assert.equal(context.state.viewpointIdentityBySide.A.threadKey, "https://chatgpt.com/c/a");
assert.equal(context.state.viewpointIdentityBySide.D.threadKey, dIdentityBefore.threadKey);
assert.notEqual(context.state.viewpointIdentityBySide.A.provenanceId, context.state.viewpointIdentityBySide.D.provenanceId,
  "same-provider logical agents must retain independent provenance");

// Completion generation checks remain per side. A's old response is stale after
// replacement, while D's current generation remains independently acceptable.
assert.equal(context.generationMatches(context.state.generationIdBySide.A, "A-old"), false,
  "A's delayed old response must be rejected after replacement");
assert.equal(context.generationMatches(context.state.generationIdBySide.D, dResult.generationId), true,
  "D's current response must remain valid despite A's replacement");
assert.equal(context.generationMatches(context.state.generationIdBySide.E, eGenerationBefore), true,
  "untouched same-family agent E must remain armed with its own generation");

// Ensure both actual provider calls occurred exactly once, without cross-side
// duplication caused by the layered resend/viewpoint wrappers.
assert.equal(dispatchOrder.filter(item => item === "start:A").length, 1);
assert.equal(dispatchOrder.filter(item => item === "start:D").length, 1);

console.log("viewpoint-resend-isolation: ok");
