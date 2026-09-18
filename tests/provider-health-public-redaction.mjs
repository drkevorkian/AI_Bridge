import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const healthSrc = fs.readFileSync(path.join(root, "provider-health-runtime.js"), "utf8");
const capsSrc = fs.readFileSync(path.join(root, "agent-capabilities.js"), "utf8");
const rosterSrc = fs.readFileSync(path.join(root, "roster-state-adapter.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

const listeners = [];
const state = {
  agentCount: 1,
  tabA: 41,
  labelA: "ChatGPT",
  startSide: "A",
  sessionActive: false,
  running: false,
  generationIdBySide: { A: null }
};

const context = vm.createContext({
  URL, console, Object, Array, Number, String, Boolean, Set, Map, Promise, RangeError, Error,
  state,
  requireExtensionPage(sender, action) {
    if (!String(sender?.url || "").startsWith("chrome-extension://bridge/")) {
      throw new Error(`${action} is only available from the dashboard or popup.`);
    }
  },
  chrome: {
    tabs: {
      async get(id) {
        assert.equal(Number(id), 41);
        return { id: 41, url: "https://chatgpt.com/c/secret-thread?private=query#fragment" };
      },
      async sendMessage(id, msg) {
        assert.equal(Number(id), 41);
        assert.equal(msg?.type, "AI_BRIDGE_PING");
        return { ok: true };
      }
    },
    runtime: {
      getURL() { return "chrome-extension://bridge/"; },
      onMessage: { addListener(fn) { listeners.push(fn); } }
    }
  }
});
context.globalThis = context;
vm.runInContext(capsSrc, context, { filename: "agent-capabilities.js" });
vm.runInContext(rosterSrc, context, { filename: "roster-state-adapter.js" });
context.__AI_BRIDGE_DYNAMIC_AGENTS_V1__ = Object.freeze({
  version: 1,
  uniqueTabBinding: true,
  liveSides() { return ["A"]; }
});
vm.runInContext(healthSrc, context, { filename: "provider-health-runtime.js" });

async function request(msg) {
  assert.equal(listeners.length, 1);
  return await new Promise((resolve, reject) => {
    const keepAlive = listeners[0](msg, { url: "chrome-extension://bridge/dashboard.html" }, resolve);
    if (keepAlive !== true) reject(new Error("Provider Health listener must remain asynchronous."));
  });
}

// Internal worker state retains the sensitive identity required for duplicate
// tab/thread classification.
const internal = await context.probeActiveAgents({ force: true });
assert.equal(internal.bySide.A.tabId, 41);
assert.equal(internal.bySide.A.threadKey, "https://chatgpt.com/c/secret-thread");
assert.equal(internal.bySide.A.threadPath, "/c/secret-thread");

// Extension-page health telemetry gets an explicit allowlisted projection.
const healthReply = await request({ type: "AI_BRIDGE_PROVIDER_HEALTH", force: true });
assert.equal(healthReply.ok, true);
assert.equal(healthReply.health.bySide.A.status, "READY");
assert.equal(healthReply.health.bySide.A.threadPath, "/c/secret-thread");
assert.equal(Object.prototype.hasOwnProperty.call(healthReply.health.bySide.A, "tabId"), false);
assert.equal(Object.prototype.hasOwnProperty.call(healthReply.health.bySide.A, "threadKey"), false);
assert.doesNotMatch(JSON.stringify(healthReply.health), /secret-thread\?private|#fragment/);

// Adaptive Selector must expose the same redacted health projection while its
// recommendation is still calculated from the full internal snapshot.
const adaptiveReply = await request({
  type: "AI_BRIDGE_ADAPTIVE_SELECT",
  preferredSide: "A",
  force: true
});
assert.equal(adaptiveReply.ok, true);
assert.equal(adaptiveReply.recommendation.side, "A");
assert.equal(Object.prototype.hasOwnProperty.call(adaptiveReply.health.bySide.A, "tabId"), false);
assert.equal(Object.prototype.hasOwnProperty.call(adaptiveReply.health.bySide.A, "threadKey"), false);
assert.equal(adaptiveReply.health.bySide.A.threadPath, "/c/secret-thread");

assert.equal(context.__AI_BRIDGE_PROVIDER_HEALTH_V1__.publicHealthRedactsSensitiveIdentity, true);
assert.equal(context.__AI_BRIDGE_PROVIDER_HEALTH_V1__.readsRosterThroughAdapter, true);
assert.match(
  wrapper,
  /__AI_BRIDGE_PROVIDER_HEALTH_V1__\?\.publicHealthRedactsSensitiveIdentity\s*!==\s*true/,
  "service-worker bootstrap must fail closed if public Provider Health identity redaction disappears"
);

console.log("provider-health-public-redaction: ok");
