import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "dashboard-provider-health-live-refresh.js"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "dashboard-bootstrap.js"), "utf8");

assert.match(bootstrap, /dashboard-provider-health-live-refresh\.js/);
assert.match(bootstrap, /providerHealthLiveRefreshAdapter:\s*true/);
assert.match(source, /boundTabLifecycleRefresh:\s*true/);
assert.match(source, /authoritativeReprobe:\s*true/);
assert.doesNotMatch(source, /AI_BRIDGE_PROVIDER_HEALTH_INVALIDATED/,
  "dashboard lifecycle refresh should not trust a second cross-context health payload");

const elements = new Map([
  ["agentCount", { value: "3" }],
  ["tabA", { value: "11" }],
  ["tabB", { value: "22" }],
  ["tabC", { value: "33" }],
  ["tabD", { value: "44" }],
  ["tabE", { value: "55" }]
]);
const listeners = { updated: [], removed: [], replaced: [] };
const scheduled = [];
const refreshCalls = [];
let nextTimerId = 1;

const windowObject = {
  __AI_BRIDGE_DYNAMIC_DASHBOARD_V1__: Object.freeze({
    async refreshHealth(force) {
      refreshCalls.push(force);
    }
  })
};

const context = vm.createContext({
  Object, Array, Number, String, Boolean, Set, Map, Promise, Error,
  window: windowObject,
  document: {
    getElementById(id) {
      return elements.get(id) || null;
    }
  },
  setTimeout(fn, ms) {
    const id = nextTimerId++;
    scheduled.push({ id, fn, ms });
    return id;
  },
  chrome: {
    tabs: {
      onUpdated: { addListener(fn) { listeners.updated.push(fn); } },
      onRemoved: { addListener(fn) { listeners.removed.push(fn); } },
      onReplaced: { addListener(fn) { listeners.replaced.push(fn); } }
    }
  }
});

vm.runInContext(source, context, { filename: "dashboard-provider-health-live-refresh.js" });

assert.equal(listeners.updated.length, 1);
assert.equal(listeners.removed.length, 1);
assert.equal(listeners.replaced.length, 1);
assert.equal(windowObject.__AI_BRIDGE_DASHBOARD_HEALTH_LIVE_REFRESH_V1__.version, 1);
assert.equal(windowObject.__AI_BRIDGE_DASHBOARD_HEALTH_LIVE_REFRESH_V1__.coalescedRefresh, true);

// Unrelated browser activity and non-lifecycle tab updates must not trigger work.
listeners.updated[0](999, { url: "https://example.com/" });
listeners.updated[0](11, { title: "ChatGPT" });
assert.equal(scheduled.length, 0);

// A navigation often produces both loading and URL updates. They must coalesce
// into one authoritative health refresh instead of creating a refresh storm.
listeners.updated[0](11, { status: "loading" });
listeners.updated[0](11, { url: "https://example.com/" });
assert.equal(scheduled.length, 1);
assert.equal(scheduled[0].ms, 40);
scheduled.shift().fn();
await Promise.resolve();
await Promise.resolve();
assert.deepEqual(refreshCalls, [true]);

// Hidden/inactive logical slots must not cause dashboard work until activated.
listeners.removed[0](44);
assert.equal(scheduled.length, 0);
elements.get("agentCount").value = "4";
listeners.removed[0](44);
assert.equal(scheduled.length, 1);
scheduled.shift().fn();
await Promise.resolve();
await Promise.resolve();
assert.deepEqual(refreshCalls, [true, true]);

// Removal and replacement of currently bound tabs are both health-relevant.
listeners.removed[0](11);
assert.equal(scheduled.length, 1);
scheduled.shift().fn();
await Promise.resolve();
await Promise.resolve();
listeners.replaced[0](222, 22);
assert.equal(scheduled.length, 1);
scheduled.shift().fn();
await Promise.resolve();
await Promise.resolve();
assert.deepEqual(refreshCalls, [true, true, true, true]);

console.log("dashboard-provider-health-live-refresh: ok");
