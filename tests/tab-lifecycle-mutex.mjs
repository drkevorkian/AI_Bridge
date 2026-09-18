import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "coordinator-mutex-prelude.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

assert.match(wrapper, /serializesTabRemovalLifecycle !== true/);
assert.match(wrapper, /serializesTabReplacementLifecycle !== true/);

const runtimeListeners = [];
const removedListeners = [];
const replacedListeners = [];
const order = [];
let releaseBlocker;
const blocker = new Promise(resolve => { releaseBlocker = resolve; });

const sandbox = {
  console,
  URL,
  Promise,
  Number,
  String,
  Object,
  Array,
  Set,
  globalThis: null,
  state: {
    tabA: 10,
    tabB: 20,
    tabC: 30,
    tabD: 40,
    tabE: 50,
    generationIdBySide: {}
  },
  __AI_BRIDGE_AGENT_CAPABILITIES__: {
    supportedAgentSides: ["A", "B", "C", "D", "E"]
  },
  chrome: {
    runtime: {
      onMessage: {
        addListener(fn) { runtimeListeners.push(fn); }
      }
    },
    tabs: {
      onRemoved: {
        addListener(fn) { removedListeners.push(fn); }
      },
      onReplaced: {
        addListener(fn) { replacedListeners.push(fn); }
      }
    }
  }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "coordinator-mutex-prelude.js" });

const contract = sandbox.__AI_BRIDGE_COORDINATOR_MUTEX__;
assert.equal(contract.version, 6);
assert.equal(contract.serializesTabRemovalLifecycle, true);
assert.equal(contract.serializesTabReplacementLifecycle, true);
assert.equal(typeof sandbox.enqueueCoordinatorMutation, "function");

sandbox.chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
  order.push(`replace-start:${addedTabId}:${removedTabId}`);
  await Promise.resolve();
  order.push("replace-end");
});
assert.equal(replacedListeners.length, 1);

// Hold the coordinator queue with an earlier mutation. A replacement event fired
// now must not execute its listener until that mutation releases.
const blockerTask = sandbox.enqueueCoordinatorMutation(async () => {
  order.push("blocker-start");
  await blocker;
  order.push("blocker-end");
});
await Promise.resolve();
replacedListeners[0](99, 10);
await Promise.resolve();
assert.deepEqual(order, ["blocker-start"]);

releaseBlocker();
await blockerTask;
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(order, [
  "blocker-start",
  "blocker-end",
  "replace-start:99:10",
  "replace-end"
]);

// Removal remains serialized by the same authority queue.
sandbox.chrome.tabs.onRemoved.addListener(async tabId => {
  order.push(`remove:${tabId}`);
});
assert.equal(removedListeners.length, 1);
const hold2 = sandbox.enqueueCoordinatorMutation(async () => {
  order.push("block2");
});
removedListeners[0](20, {});
await hold2;
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(order.at(-1), "remove:20");

console.log("tab-lifecycle-mutex: replacement/removal lifecycle serialized ok");
