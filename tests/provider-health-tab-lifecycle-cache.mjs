import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const healthSrc = fs.readFileSync(path.join(root, "provider-health-runtime.js"), "utf8");
const capsSrc = fs.readFileSync(path.join(root, "agent-capabilities.js"), "utf8");
const rosterSrc = fs.readFileSync(path.join(root, "roster-state-adapter.js"), "utf8");

const tabs = new Map([
  [11, { id: 11, url: "https://chatgpt.com/" }],
  [22, { id: 22, url: "https://grok.com/" }],
  [33, { id: 33, url: "https://claude.ai/" }],
  [999, { id: 999, url: "https://example.com/" }]
]);
const pingable = new Set([11, 22, 33]);
const listeners = { updated: [], removed: [], replaced: [], message: [] };
let blockNextTab11Ping = false;
let releaseBlockedTab11Ping = null;
const state = {
  agentCount: 3,
  tabA: 11,
  tabB: 22,
  tabC: 33,
  startSide: "A",
  sessionActive: false,
  running: false,
  generationIdBySide: { A: null, B: null, C: null }
};

const context = vm.createContext({
  URL, console, Object, Array, Number, String, Boolean, Set, Map, Promise, RangeError, Error,
  state,
  requireExtensionPage() {},
  chrome: {
    tabs: {
      async get(id) {
        if (!tabs.has(Number(id))) throw new Error("no tab");
        return tabs.get(Number(id));
      },
      async sendMessage(id, msg) {
        if (!pingable.has(Number(id)) || msg?.type !== "AI_BRIDGE_PING") throw new Error("no receiver");
        if (Number(id) === 11 && blockNextTab11Ping) {
          blockNextTab11Ping = false;
          await new Promise(resolve => {
            releaseBlockedTab11Ping = resolve;
          });
          releaseBlockedTab11Ping = null;
        }
        return { ok: true };
      },
      onUpdated: { addListener(fn) { listeners.updated.push(fn); } },
      onRemoved: { addListener(fn) { listeners.removed.push(fn); } },
      onReplaced: { addListener(fn) { listeners.replaced.push(fn); } }
    },
    runtime: {
      getURL() { return "chrome-extension://bridge/"; },
      onMessage: { addListener(fn) { listeners.message.push(fn); } }
    }
  }
});
context.globalThis = context;
vm.runInContext(capsSrc, context, { filename: "agent-capabilities.js" });
vm.runInContext(rosterSrc, context, { filename: "roster-state-adapter.js" });
context.__AI_BRIDGE_DYNAMIC_AGENTS_V1__ = Object.freeze({
  version: 1,
  uniqueTabBinding: true,
  liveSides() {
    const caps = context.__AI_BRIDGE_AGENT_CAPABILITIES__;
    return caps.sideIdsForCount(caps.normalizeAgentCount(context.state.agentCount));
  }
});
vm.runInContext(healthSrc, context, { filename: "provider-health-runtime.js" });

async function waitForBlockedTab11Ping() {
  for (let i = 0; i < 100 && !releaseBlockedTab11Ping; i += 1) {
    await Promise.resolve();
  }
  assert.equal(typeof releaseBlockedTab11Ping, "function", "tab 11 ping should be blocked for race test");
}

assert.equal(listeners.updated.length, 1);
assert.equal(listeners.removed.length, 1);
assert.equal(listeners.replaced.length, 1);
assert.equal(context.__AI_BRIDGE_PROVIDER_HEALTH_V1__.tabLifecycleInvalidatesProbeCache, true);
assert.equal(context.__AI_BRIDGE_PROVIDER_HEALTH_V1__.rejectsUnstableInflightProbes, true);

const ready = await context.probeActiveAgents({ force: true });
assert.equal(ready.bySide.A.status, "READY");
const cached = await context.probeActiveAgents({ force: false });
assert.equal(cached, ready, "unchanged coordinator and tab state should reuse the short cache");

// Unrelated tabs must not evict the cache.
listeners.updated[0](999, { url: "https://example.com/elsewhere" }, tabs.get(999));
const afterUnrelated = await context.probeActiveAgents({ force: false });
assert.equal(afterUnrelated, ready);

// A bound tab can navigate without coordinator state changing. The navigation
// event must invalidate READY immediately so the next non-forced probe rechecks
// provider trust instead of serving the old snapshot.
tabs.set(11, { id: 11, url: "https://example.com/" });
listeners.updated[0](11, { url: "https://example.com/" }, tabs.get(11));
const afterNavigation = await context.probeActiveAgents({ force: false });
assert.notEqual(afterNavigation, ready);
assert.equal(afterNavigation.bySide.A.status, "UNSUPPORTED");
assert.equal(afterNavigation.bySide.A.ready, false);

// Removal must likewise invalidate even though state.tabA still contains 11.
tabs.set(11, { id: 11, url: "https://chatgpt.com/" });
const restored = await context.probeActiveAgents({ force: true });
assert.equal(restored.bySide.A.status, "READY");
tabs.delete(11);
listeners.removed[0](11, { windowId: 1, isWindowClosing: false });
const afterRemoval = await context.probeActiveAgents({ force: false });
assert.notEqual(afterRemoval, restored);
assert.equal(afterRemoval.bySide.A.status, "MISSING_TAB");

// Replaced-tab events must evict the old bound tab's cached health as well.
tabs.set(11, { id: 11, url: "https://chatgpt.com/" });
const beforeReplace = await context.probeActiveAgents({ force: true });
assert.equal(beforeReplace.bySide.A.status, "READY");
tabs.delete(11);
listeners.replaced[0](111, 11);
const afterReplace = await context.probeActiveAgents({ force: false });
assert.notEqual(afterReplace, beforeReplace);
assert.equal(afterReplace.bySide.A.status, "MISSING_TAB");

// A lifecycle event can arrive while a forced probe is already waiting on the
// bound provider. The old in-flight probe must not repopulate READY after the
// invalidation. It should discard the mixed-state result and retry from scratch.
tabs.set(11, { id: 11, url: "https://chatgpt.com/" });
blockNextTab11Ping = true;
const inflightNavigation = context.probeActiveAgents({ force: true });
await waitForBlockedTab11Ping();
tabs.set(11, { id: 11, url: "https://example.com/" });
listeners.updated[0](11, { url: "https://example.com/" }, tabs.get(11));
releaseBlockedTab11Ping();
const afterInflightNavigation = await inflightNavigation;
assert.equal(afterInflightNavigation.bySide.A.status, "UNSUPPORTED");
assert.equal(afterInflightNavigation.bySide.A.ready, false);

// Coordinator state may also change while a probe is in flight. Even without a
// Chrome lifecycle event, the end-of-probe fingerprint must reject the original
// READY result and retry so READY -> GENERATING cannot be missed.
tabs.set(11, { id: 11, url: "https://chatgpt.com/" });
state.sessionActive = false;
state.running = false;
state.generationIdBySide.A = null;
blockNextTab11Ping = true;
const inflightGeneration = context.probeActiveAgents({ force: true });
await waitForBlockedTab11Ping();
state.sessionActive = true;
state.running = true;
state.generationIdBySide.A = "A-1720000000000-race1111";
releaseBlockedTab11Ping();
const afterInflightGeneration = await inflightGeneration;
assert.equal(afterInflightGeneration.bySide.A.status, "GENERATING");
assert.equal(afterInflightGeneration.bySide.A.reachable, true);
assert.equal(afterInflightGeneration.bySide.A.ready, false);

console.log("provider-health-tab-lifecycle-cache: ok");
