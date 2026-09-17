import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "coordinator-mutex-prelude.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

assert.match(wrapper, /serializesClientStateReads !== true/);

const registered = [];
const order = [];
let releaseStart;
const startGate = new Promise(resolve => { releaseStart = resolve; });

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
assert.equal(contract.serializesClientStateReads, true);
assert.equal(contract.isSerializedType("AI_BRIDGE_GET_STATE"), true);

sandbox.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "AI_BRIDGE_START") {
    order.push("start-begin");
    startGate.then(() => {
      order.push("start-end");
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message.type === "AI_BRIDGE_GET_STATE") {
    order.push("get-state");
    sendResponse({ ok: true, state: { committed: true } });
    return true;
  }
});
assert.equal(registered.length, 1);

const sender = { url: "chrome-extension://test/dashboard.html" };
const replies = [];
registered[0]({ type: "AI_BRIDGE_START" }, sender, value => replies.push(["start", value]));
registered[0]({ type: "AI_BRIDGE_GET_STATE" }, sender, value => replies.push(["state", value]));

await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(order, ["start-begin"], "GET_STATE must not observe state while Start is mid-mutation");

releaseStart();
await new Promise(resolve => setTimeout(resolve, 0));
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(order, ["start-begin", "start-end", "get-state"]);
assert.deepEqual(replies.map(item => item[0]), ["start", "state"]);

console.log("client-state-mutex: GET_STATE waits for committed mutation boundary ok");
