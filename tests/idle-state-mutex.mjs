import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "coordinator-mutex-prelude.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

assert.match(wrapper, /serializesIdleStateMutations !== true/);

const registered = [];
const order = [];
const blockers = new Map();
function makeBlocker(type) {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  blockers.set(type, { promise, release });
}
for (const type of ["AI_BRIDGE_NEW_CHATS","AI_BRIDGE_CLEAR_ARTIFACTS","AI_BRIDGE_CLOUD_PULL"]) makeBlocker(type);

const sandbox = {
  console, URL, Promise, Number, String, Object, Array, Set,
  globalThis: null,
  state: { tabA: 1, tabB: 2, tabC: 3, generationIdBySide: {} },
  __AI_BRIDGE_AGENT_CAPABILITIES__: { supportedAgentSides: ["A","B","C","D","E"] },
  chrome: {
    runtime: { onMessage: { addListener(fn) { registered.push(fn); } } },
    tabs: {
      onRemoved: { addListener() {} },
      onReplaced: { addListener() {} }
    }
  }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "coordinator-mutex-prelude.js" });

const contract = sandbox.__AI_BRIDGE_COORDINATOR_MUTEX__;
assert.equal(contract.serializesIdleStateMutations, true);
for (const type of blockers.keys()) assert.equal(contract.isSerializedType(type), true);

sandbox.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (blockers.has(message.type)) {
    order.push(`${message.type}:start`);
    blockers.get(message.type).promise.then(() => {
      order.push(`${message.type}:end`);
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message.type === "AI_BRIDGE_START") {
    order.push("START");
    sendResponse({ ok: true });
    return true;
  }
});
assert.equal(registered.length, 1);
const sender = { url: "chrome-extension://test/dashboard.html" };

for (const type of blockers.keys()) {
  order.length = 0;
  registered[0]({ type }, sender, () => {});
  registered[0]({ type: "AI_BRIDGE_START" }, sender, () => {});
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(order, [`${type}:start`], `${type} must hold Start behind the coordinator mutex`);
  blockers.get(type).release();
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(order, [`${type}:start`, `${type}:end`, "START"]);
}

console.log("idle-state-mutex: New Chats, Clear Vault, and Cloud Pull serialize with Start ok");
