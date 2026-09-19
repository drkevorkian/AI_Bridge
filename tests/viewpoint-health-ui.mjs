import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capsSrc = fs.readFileSync(path.join(root, "agent-capabilities.js"), "utf8");
const rosterSrc = fs.readFileSync(path.join(root, "roster-state-adapter.js"), "utf8");
const healthSrc = fs.readFileSync(path.join(root, "provider-health-runtime.js"), "utf8");
const dashboardSrc = fs.readFileSync(path.join(root, "dashboard-dynamic-agents.js"), "utf8");
const css = fs.readFileSync(path.join(root, "dashboard-dynamic-agents.css"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

assert.match(healthSrc, /"DUPLICATE_THREAD"/);
assert.match(healthSrc, /threadPath/);
assert.match(healthSrc, /includesSanitizedThreadIdentity:\s*true/);
assert.match(healthSrc, /detectsDuplicateThreads:\s*true/);
assert.match(wrapper, /includesSanitizedThreadIdentity\?\.valueOf|includesSanitizedThreadIdentity/);
assert.match(dashboardSrc, /formatThreadBadgeText/);
assert.match(dashboardSrc, /duplicateThreadStartBlock:\s*true/);
assert.match(dashboardSrc, /status === "DUPLICATE_THREAD"/);
assert.match(css, /\.agent-card-thread-badge/);
assert.doesNotMatch(css, /#f59e0b|#d97706|#2a2a2a/i, "viewpoint badges must not hard-code proposed theme colors");

const tabs = new Map([
  [11, { id: 11, url: "https://chatgpt.com/c/shared?token=secret#frag" }],
  [22, { id: 22, url: "https://chatgpt.com/c/shared?other=drop" }],
  [33, { id: 33, url: "https://grok.com/chat/other" }]
]);

function loadHealth({ duplicateProviderAgentsEnabled }) {
  const context = vm.createContext({
    URL, console, Object, Array, Number, String, Boolean, Set, Map, Promise, RangeError, Error,
    state: { agentCount: 3, tabA: 11, tabB: 22, tabC: 33 },
    chrome: {
      tabs: {
        async get(id) {
          const tab = tabs.get(Number(id));
          if (!tab) throw new Error("missing tab");
          return tab;
        },
        async sendMessage() { return { ok: true }; }
      },
      runtime: {
        getURL() { return "chrome-extension://bridge/"; },
        onMessage: { addListener() {} }
      }
    }
  });
  context.globalThis = context;
  vm.runInContext(capsSrc, context, { filename: "agent-capabilities.js" });
  vm.runInContext(rosterSrc, context, { filename: "roster-state-adapter.js" });
  context.__AI_BRIDGE_AGENT_CAPABILITIES__ = Object.freeze({
    ...context.__AI_BRIDGE_AGENT_CAPABILITIES__,
    duplicateProviderAgentsEnabled
  });
  context.__AI_BRIDGE_DYNAMIC_AGENTS_V1__ = Object.freeze({
    version: 1,
    uniqueTabBinding: true,
    liveSides() { return ["A", "B", "C"]; }
  });
  vm.runInContext(healthSrc, context, { filename: "provider-health-runtime.js" });
  return context;
}

const currentMode = loadHealth({ duplicateProviderAgentsEnabled: false });
const currentHealth = await currentMode.probeActiveAgents({ force: true });
assert.equal(currentHealth.bySide.A.status, "DUPLICATE_PROVIDER");
assert.equal(currentHealth.bySide.B.status, "DUPLICATE_PROVIDER");
assert.equal(currentHealth.bySide.A.threadPath, "/c/shared");
assert.equal(currentHealth.bySide.A.threadKey, "https://chatgpt.com/c/shared");
assert.ok(!currentHealth.bySide.A.threadKey.includes("token="));
assert.ok(!currentHealth.bySide.A.threadKey.includes("#"));

const viewpointMode = loadHealth({ duplicateProviderAgentsEnabled: true });
const viewpointHealth = await viewpointMode.probeActiveAgents({ force: true });
assert.equal(viewpointHealth.bySide.A.status, "DUPLICATE_THREAD");
assert.equal(viewpointHealth.bySide.B.status, "DUPLICATE_THREAD");
assert.equal(viewpointHealth.bySide.A.ready, false);
assert.equal(viewpointHealth.bySide.B.ready, false);
assert.equal(viewpointHealth.bySide.C.status, "READY");

console.log("viewpoint-health-ui: ok");
