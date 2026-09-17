import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "coordinator-mutex-prelude.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

assert.match(wrapper, /serializesAgentCountMutation !== true/);

const registered = [];
const order = [];
let releaseCountWrite;
const countWrite = new Promise(resolve => { releaseCountWrite = resolve; });

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
  state: { tabA: 1, tabB: 2, tabC: 3, generationIdBySide: {} },
  __AI_BRIDGE_AGENT_CAPABILITIES__: { supportedAgentSides: ["A","B","C","D","E"] },
  chrome: {
    runtime: {
      onMessage: {
        addListener(fn) { registered.push(fn); }
      }
    },
    tabs: {
      onRemoved: { addListener() {} },
      onReplaced: { addListener() {} }
    }
  }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "coordinator-mutex-prelude.js" });

assert.equal(sandbox.__AI_BRIDGE_COORDINATOR_MUTEX__.serializesAgentCountMutation, true);
assert.equal(sandbox.__AI_BRIDGE_COORDINATOR_MUTEX__.isSerializedType("AI_BRIDGE_SET_AGENT_COUNT"), true);

sandbox.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "AI_BRIDGE_SET_AGENT_COUNT") {
    order.push("count-start");
    countWrite.then(() => {
      order.push("count-end");
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message.type === "AI_BRIDGE_START") {
    order.push("start");
    sendResponse({ ok: true });
    return true;
  }
});
assert.equal(registered.length, 1);

const sender = { url: "chrome-extension://test/dashboard.html" };
const replies = [];
registered[0]({ type: "AI_BRIDGE_SET_AGENT_COUNT", agentCount: 5 }, sender, value => replies.push(["count", value]));
registered[0]({ type: "AI_BRIDGE_START" }, sender, value => replies.push(["start", value]));

await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(order, ["count-start"], "Start must wait for the in-flight count mutation");

releaseCountWrite();
await new Promise(resolve => setTimeout(resolve, 0));
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(order, ["count-start", "count-end", "start"]);
assert.equal(replies.length, 2);

console.log("agent-count-mutex: count mutation serialized before Start ok");
