import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");
const healthSrc = fs.readFileSync(path.join(root, "provider-health-runtime.js"), "utf8");
const capsSrc = fs.readFileSync(path.join(root, "agent-capabilities.js"), "utf8");

assert.ok(wrapper.includes('importScripts("provider-health-runtime.js")'));
assert.ok(
  wrapper.indexOf('importScripts("coordinator-dynamic-agents.js")') <
    wrapper.indexOf('importScripts("provider-health-runtime.js")')
);
assert.ok(healthSrc.includes('sendsProviderPrompts: false'));
assert.ok(healthSrc.includes('mutatesRouting: false'));
assert.ok(healthSrc.includes('stateKeyedProbeCache: true'));
assert.ok(healthSrc.includes("AI_BRIDGE_PROVIDER_HEALTH"));
assert.doesNotMatch(healthSrc, /AI_BRIDGE_SEND/);

const tabs = new Map([
  [11, { id: 11, url: "https://chatgpt.com/" }],
  [22, { id: 22, url: "https://grok.com/" }],
  [33, { id: 33, url: "https://claude.ai/" }],
  [44, { id: 44, url: "https://gemini.google.com/" }],
  [66, { id: 66, url: "https://chatgpt.com/c/other" }],
  [77, { id: 77, url: "https://example.com/" }],
  [88, { id: 88, url: "https://chatgpt.com/c/other?different=query#fragment" }]
]);
const pingable = new Set([11, 22, 33, 44, 66, 88]);

function load(state, { senderUrl = "chrome-extension://bridge/dashboard.html" } = {}) {
  const messages = [];
  const context = vm.createContext({
    URL, console, Object, Array, Number, String, Boolean, Set, Map, Promise, RangeError, Error,
    state,
    requireExtensionPage(sender, action) {
      const url = String(sender?.url || "");
      if (!url.startsWith("chrome-extension://bridge/")) throw new Error(`${action} is only available from the dashboard or popup.`);
    },
    chrome: {
      tabs: {
        async get(id) {
          if (!tabs.has(Number(id))) throw new Error("no tab");
          return tabs.get(Number(id));
        },
        async sendMessage(id, msg) {
          if (!pingable.has(Number(id))) throw new Error("no receiver");
          if (msg?.type !== "AI_BRIDGE_PING") throw new Error("unexpected message");
          return { ok: true };
        }
      },
      runtime: {
        getURL() { return "chrome-extension://bridge/"; },
        onMessage: {
          addListener(fn) { messages.push(fn); }
        }
      }
    }
  });
  context.globalThis = context;
  vm.runInContext(capsSrc, context, { filename: "agent-capabilities.js" });
  context.__AI_BRIDGE_DYNAMIC_AGENTS_V1__ = Object.freeze({
    version: 1,
    uniqueTabBinding: true,
    liveSides() {
      const count = context.__AI_BRIDGE_AGENT_CAPABILITIES__.normalizeAgentCount(context.state.agentCount);
      return context.__AI_BRIDGE_AGENT_CAPABILITIES__.sideIdsForCount(count);
    }
  });
  vm.runInContext(healthSrc, context, { filename: "provider-health-runtime.js" });
  context._messages = messages;
  context._senderUrl = senderUrl;
  return context;
}

async function request(context, msg, senderUrl = context._senderUrl) {
  const listener = context._messages[0];
  return await new Promise((resolve, reject) => {
    const ret = listener(msg, { url: senderUrl }, resolve);
    if (ret !== true) reject(new Error("listener must return true for async health"));
  });
}

const three = load({
  agentCount: 3,
  tabA: 11,
  tabB: 22,
  tabC: 33,
  labelA: "ChatGPT",
  startSide: "A"
});

// Before the first probe, Adaptive Selector must not invent a READY side.
const preProbePick = three.recommendStartSide(null, "A");
assert.equal(preProbePick.side, null);
assert.match(preProbePick.reason, /not been probed|no READY/i);

const health = await three.probeActiveAgents({ force: true });
assert.equal(health.agentCount, 3);
assert.equal(JSON.stringify(Array.from(health.sides)), JSON.stringify(["A", "B", "C"]));
assert.equal(health.bySide.A.status, "READY");
assert.equal(health.bySide.A.providerId, "chatgpt");
assert.equal(health.bySide.B.providerId, "grok");
assert.equal(JSON.stringify(Array.from(health.readySides)), JSON.stringify(["A", "B", "C"]));

const msg = await request(three, { type: "AI_BRIDGE_PROVIDER_HEALTH", force: true });
assert.equal(msg.ok, true);
assert.equal(msg.health.bySide.C.status, "READY");

const denied = await request(three, { type: "AI_BRIDGE_PROVIDER_HEALTH" }, "https://chatgpt.com/");
assert.equal(denied.ok, false);
assert.match(String(denied.error), /dashboard or popup/);

const unassigned = load({ agentCount: 4, tabA: 11, tabB: 22, tabC: 33 });
const missing = await unassigned.probeActiveAgents({ force: true });
assert.equal(missing.bySide.D.status, "UNASSIGNED");
assert.equal(missing.bySide.D.ready, false);

const badHost = load({ agentCount: 3, tabA: 77, tabB: 22, tabC: 33 });
assert.equal((await badHost.probeActiveAgents({ force: true })).bySide.A.status, "UNSUPPORTED");

const gone = load({ agentCount: 3, tabA: 99, tabB: 22, tabC: 33 });
assert.equal((await gone.probeActiveAgents({ force: true })).bySide.A.status, "MISSING_TAB");

const sharedTab = load({ agentCount: 3, tabA: 11, tabB: 11, tabC: 33 });
const shared = await sharedTab.probeActiveAgents({ force: true });
assert.equal(shared.bySide.A.status, "DUPLICATE_TAB");
assert.equal(shared.bySide.B.status, "DUPLICATE_TAB");
assert.equal(shared.bySide.C.status, "READY");

// Production viewpoint mode allows the same provider family when tab and
// sanitized thread identity are both distinct.
const dupFamily = load({ agentCount: 3, tabA: 11, tabB: 66, tabC: 22 });
const dup = await dupFamily.probeActiveAgents({ force: true });
assert.equal(dup.bySide.A.status, "READY");
assert.equal(dup.bySide.B.status, "READY");
assert.equal(dup.bySide.C.status, "READY");

// Query/hash differences never create a distinct viewpoint for the same thread.
const dupThread = load({ agentCount: 3, tabA: 66, tabB: 88, tabC: 22 });
const sameThread = await dupThread.probeActiveAgents({ force: true });
assert.equal(sameThread.bySide.A.status, "DUPLICATE_THREAD");
assert.equal(sameThread.bySide.B.status, "DUPLICATE_THREAD");
assert.equal(sameThread.bySide.C.status, "READY");
assert.equal(sameThread.bySide.A.threadKey, "https://chatgpt.com/c/other");
assert.equal(sameThread.bySide.B.threadKey, "https://chatgpt.com/c/other");

const pick = three.recommendStartSide(health, "B");
assert.equal(pick.side, "B");
const pickBlocked = sharedTab.recommendStartSide(shared, "A");
assert.equal(pickBlocked.side, "C");

// A provider with an active generation is reachable but not READY for a new
// adaptive-selector start. The selector must skip it instead of recommending
// concurrent work into the same logical-agent turn.
const busyContext = load({
  agentCount: 3,
  tabA: 11,
  tabB: 22,
  tabC: 33,
  startSide: "A",
  sessionActive: true,
  running: true,
  generationIdBySide: { A: "A-1720000000000-busy1111", B: null, C: null }
});
const busyHealth = await busyContext.probeActiveAgents({ force: true });
assert.equal(busyHealth.bySide.A.status, "GENERATING");
assert.equal(busyHealth.bySide.A.reachable, true);
assert.equal(busyHealth.bySide.A.ready, false);
assert.equal(JSON.stringify(Array.from(busyHealth.readySides)), JSON.stringify(["B", "C"]));
assert.equal(JSON.stringify(Array.from(busyHealth.blockedSides)), JSON.stringify(["A"]));
const busyPick = busyContext.recommendStartSide(busyHealth, "A");
assert.equal(busyPick.side, "B");
assert.match(busyPick.reason, /A is not READY; using B/);

// The probe cache must never preserve READY across health-relevant coordinator
// state changes, even when the second request arrives inside the 750ms cache
// window. This protects direct Adaptive Selector callers, not just the dashboard.
const mutableState = {
  agentCount: 3,
  tabA: 11,
  tabB: 22,
  tabC: 33,
  startSide: "A",
  sessionActive: false,
  running: false,
  generationIdBySide: { A: null, B: null, C: null }
};
const cacheContext = load(mutableState);
const cachedReady = await cacheContext.probeActiveAgents({ force: true });
assert.equal(cachedReady.bySide.A.status, "READY");
mutableState.sessionActive = true;
mutableState.running = true;
mutableState.generationIdBySide.A = "A-1720000000000-cache111";
const cacheAfterGeneration = await cacheContext.probeActiveAgents({ force: false });
assert.notEqual(cacheAfterGeneration, cachedReady);
assert.equal(cacheAfterGeneration.bySide.A.status, "GENERATING");
assert.equal(cacheAfterGeneration.bySide.A.ready, false);
mutableState.tabA = 77;
const cacheAfterRebind = await cacheContext.probeActiveAgents({ force: false });
assert.notEqual(cacheAfterRebind, cacheAfterGeneration);
assert.equal(cacheAfterRebind.bySide.A.status, "UNSUPPORTED");
assert.equal(cacheAfterRebind.bySide.A.ready, false);

// When every live side is blocked, fail closed. Returning the first roster side
// would contradict the READY-only recommendation contract and could lead a
// future caller to dispatch into an unhealthy/busy agent.
const noneReadyContext = load({ agentCount: 3, startSide: "A" });
const noneReadyHealth = await noneReadyContext.probeActiveAgents({ force: true });
assert.deepEqual(Array.from(noneReadyHealth.readySides), []);
assert.deepEqual(Array.from(noneReadyHealth.blockedSides), ["A", "B", "C"]);
const noneReadyPick = noneReadyContext.recommendStartSide(noneReadyHealth, "A");
assert.equal(noneReadyPick.side, null);
assert.match(noneReadyPick.reason, /No READY agent/);

const select = await request(three, { type: "AI_BRIDGE_ADAPTIVE_SELECT", preferredSide: "A", force: true });
assert.equal(select.ok, true);
assert.equal(select.recommendation.side, "A");

const busySelect = await request(busyContext, { type: "AI_BRIDGE_ADAPTIVE_SELECT", preferredSide: "A", force: true });
assert.equal(busySelect.ok, true);
assert.equal(busySelect.health.bySide.A.status, "GENERATING");
assert.equal(busySelect.recommendation.side, "B");

const noneReadySelect = await request(noneReadyContext, { type: "AI_BRIDGE_ADAPTIVE_SELECT", preferredSide: "A", force: true });
assert.equal(noneReadySelect.ok, true);
assert.equal(noneReadySelect.health.readySides.length, 0);
assert.equal(noneReadySelect.recommendation.side, null);
assert.match(noneReadySelect.recommendation.reason, /No READY agent/);

assert.equal(three.__AI_BRIDGE_PROVIDER_HEALTH_V1__.stateKeyedProbeCache, true);
assert.equal(three.__AI_BRIDGE_PROVIDER_HEALTH_V1__.mutatesRouting, false);
assert.equal(three.__AI_BRIDGE_PROVIDER_HEALTH_V1__.sendsProviderPrompts, false);

console.log("dynamic-agent-provider-health: ok");
