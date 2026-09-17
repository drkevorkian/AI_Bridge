import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "dashboard-viewpoint-activation.js"), "utf8");

assert.match(src, /activationWaitsForDynamicDashboard:\s*true/,
  "viewpoint diagnostics must advertise readiness ordering");
assert.match(src, /Object\.defineProperty\(window, API_KEY/,
  "activation must wait on the dynamic dashboard API assignment itself");
assert.doesNotMatch(src, /setInterval\s*\(/,
  "bootstrap readiness must not rely on polling intervals");
assert.doesNotMatch(src, /setTimeout\s*\(/,
  "bootstrap readiness must not rely on timing guesses");

function makeScript() {
  return {
    src: "",
    async: true,
    dataset: {}
  };
}

function makeHarness(initialApi = null) {
  const appended = [];
  const existingScripts = new Map();
  const windowObject = {};
  if (initialApi) windowObject.__AI_BRIDGE_DYNAMIC_DASHBOARD_V1__ = initialApi;

  const context = vm.createContext({
    console,
    Object,
    Error,
    document: {
      querySelector(selector) {
        return existingScripts.get(selector) || null;
      },
      createElement(tag) {
        assert.equal(tag, "script");
        return makeScript();
      },
      body: {
        appendChild(node) {
          appended.push(node);
          if (node.dataset.aiBridgeViewpointQueue === "true") {
            existingScripts.set("script[data-ai-bridge-viewpoint-queue]", node);
          }
          if (node.dataset.aiBridgeViewpointBadges === "true") {
            existingScripts.set("script[data-ai-bridge-viewpoint-badges]", node);
          }
          return node;
        }
      }
    },
    chrome: {
      runtime: {
        getURL(file) { return `chrome-extension://test/${file}`; }
      }
    }
  });
  context.window = windowObject;
  Object.assign(context.window, context);
  return { context, appended, windowObject };
}

const baseApi = Object.freeze({
  version: 1,
  threadBadges: true,
  duplicateThreadStartBlock: true,
  refreshHealth() {}
});

// Slow asynchronous dynamic-dashboard initialization: activation loads first,
// but must not throw or inject dependent scripts until the API is later assigned.
{
  const { context, appended, windowObject } = makeHarness();
  vm.runInContext(src, context, { filename: "dashboard-viewpoint-activation.js" });
  assert.equal(appended.length, 0, "dependent viewpoint adapters must wait for readiness");
  assert.equal(windowObject.__AI_BRIDGE_DYNAMIC_DASHBOARD_V1__, undefined);

  windowObject.__AI_BRIDGE_DYNAMIC_DASHBOARD_V1__ = baseApi;
  assert.equal(appended.length, 2, "readiness assignment should activate both viewpoint adapters exactly once");
  assert.equal(appended[0].src, "chrome-extension://test/dashboard-viewpoint-queue.js");
  assert.equal(appended[1].src, "chrome-extension://test/dashboard-viewpoint-badges.js");
  assert.equal(windowObject.__AI_BRIDGE_DYNAMIC_DASHBOARD_V1__.viewpointModeEnabled, true);
  assert.equal(windowObject.__AI_BRIDGE_DYNAMIC_DASHBOARD_V1__.activationWaitsForDynamicDashboard, true);

  // A later reassignment must not duplicate scripts because activation has already
  // replaced the temporary accessor with the normal activated API data property.
  windowObject.__AI_BRIDGE_DYNAMIC_DASHBOARD_V1__ = windowObject.__AI_BRIDGE_DYNAMIC_DASHBOARD_V1__;
  assert.equal(appended.length, 2);
}

// Fast path: if the dynamic dashboard finished before activation loads, activate
// immediately and preserve the same safeguards/diagnostics.
{
  const { context, appended, windowObject } = makeHarness(baseApi);
  vm.runInContext(src, context, { filename: "dashboard-viewpoint-activation.js" });
  assert.equal(appended.length, 2);
  assert.equal(windowObject.__AI_BRIDGE_DYNAMIC_DASHBOARD_V1__.sanitizedViewpointBadges, true);
  assert.equal(windowObject.__AI_BRIDGE_DYNAMIC_DASHBOARD_V1__.queueObservability, true);
}

console.log("viewpoint-activation-readiness: ok");
