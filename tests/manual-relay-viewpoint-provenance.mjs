import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const manual = read("manual-relay-runtime-hardening.js");
const prelude = read("content-runtime-prelude.js");
const wrapper = read("background-wrapper.js");

assert.match(prelude, /message\?\.type\s*===\s*"AI_BRIDGE_CAPTURE_LATEST"/,
  "content runtime must special-case manual capture replies");
assert.match(prelude, /pageUrl:\s*location\.href/,
  "manual capture reply must carry the isolated world's exact page URL");
assert.match(prelude, /manualCaptureIncludesPageUrl:\s*true/);

assert.match(manual, /refreshManualRelayViewpointIdentity\(fromSide, captured\.pageUrl\)/,
  "Manual Relay must refresh viewpoint provenance from the captured page before commit");
assert.match(manual, /refreshesViewpointProvenanceFromCapturedUrl:\s*true/);
assert.match(manual, /requiresCapturePageUrl:\s*true/);
assert.match(wrapper, /refreshesViewpointProvenanceFromCapturedUrl\s*!==\s*true/,
  "service-worker bootstrap must pin the provenance-refresh capability");
assert.match(wrapper, /requiresCapturePageUrl\s*!==\s*true/,
  "service-worker bootstrap must fail closed if capture-page identity is removed");

let baseRelayCalls = 0;
let capturePageUrl = "https://chatgpt.com/c/new-thread";
const state = {
  workMode: "parallel",
  currentSide: "A",
  phasePendingSides: ["A", "B"],
  lastResponseBySide: {},
  viewpointIdentityBySide: {
    A: {
      provenanceId: "chatgpt:A:77:https://chatgpt.com/c/old-thread",
      threadKey: "https://chatgpt.com/c/old-thread",
      providerFamily: "chatgpt",
      boundTabId: 77
    }
  }
};

function conversationIdentity({ side, tabId, url }) {
  let parsed;
  try { parsed = new URL(String(url || "")); }
  catch (_) { return null; }
  if (parsed.protocol !== "https:" || parsed.hostname !== "chatgpt.com") return null;
  const threadKey = `${parsed.origin}${parsed.pathname}`;
  return {
    side,
    tabId: Number(tabId),
    familyId: "chatgpt",
    threadKey,
    provenanceId: `chatgpt:${side}:${Number(tabId)}:${threadKey}`
  };
}

const context = vm.createContext({
  console,
  Object,
  Array,
  String,
  Number,
  Boolean,
  Error,
  Promise,
  Date,
  Math,
  Map,
  Set,
  URL,
  SIDES: ["A", "B"],
  MAX_FORCE_RELAY_CHARS: 200000,
  state,
  __AI_BRIDGE_AGENT_CAPABILITIES__: {
    version: 1,
    conversationIdentity
  },
  tabForSide(side) {
    return side === "A" ? 77 : 88;
  },
  ensureTabListener: async () => ({ ok: true }),
  sanitizeForceRelaySides(values) {
    return [...new Set((Array.isArray(values) ? values : [values]).map(value => String(value).toUpperCase()))]
      .filter(side => ["A", "B"].includes(side));
  },
  isSequentialWorkMode() { return false; },
  isBatchWorkMode() { return false; },
  captureLatestFromSide: async () => ({ ok: true }),
  async forceRelayCapturedResponse() {
    baseRelayCalls += 1;
    return {
      ok: true,
      stampedIdentity: { ...state.viewpointIdentityBySide.A }
    };
  },
  chrome: {
    tabs: {
      async sendMessage(tabId, message) {
        assert.equal(tabId, 77);
        assert.equal(message.type, "AI_BRIDGE_CAPTURE_LATEST");
        return {
          ok: true,
          text: "captured answer",
          artifacts: [],
          completedAt: 1234,
          generationId: "gen-manual",
          generating: false,
          pageUrl: capturePageUrl
        };
      }
    }
  }
});
context.globalThis = context;
vm.runInContext(manual, context, { filename: "manual-relay-runtime-hardening.js" });

const result = await context.forceRelayCapturedResponse("A", ["B"]);
assert.equal(result.ok, true);
assert.equal(result.refreshedViewpointProvenance, true);
assert.equal(baseRelayCalls, 1);
assert.equal(result.stampedIdentity.threadKey, "https://chatgpt.com/c/new-thread",
  "manual transcript commit must see the newly captured thread, not stale dispatch provenance");
assert.equal(state.viewpointIdentityBySide.A.boundTabId, 77);
assert.equal(state.viewpointIdentityBySide.A.providerFamily, "chatgpt");
assert.equal(state.viewpointIdentityBySide.A.threadKey, "https://chatgpt.com/c/new-thread");

capturePageUrl = "";
baseRelayCalls = 0;
await assert.rejects(
  () => context.forceRelayCapturedResponse("A", ["B"]),
  /capture did not include page identity/i,
  "missing capture-page identity must fail closed instead of reusing stale provenance"
);
assert.equal(baseRelayCalls, 0, "unsafe manual relay must not reach the legacy commit/routing helper");

capturePageUrl = "https://evil.example/c/spoof";
await assert.rejects(
  () => context.forceRelayCapturedResponse("A", ["B"]),
  /trusted provider conversation/i,
  "untrusted capture URL must never become viewpoint provenance"
);

console.log("manual-relay-viewpoint-provenance: ok");
