import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prelude = fs.readFileSync(path.join(root, "coordinator-mutex-prelude.js"), "utf8");
const generation = fs.readFileSync(path.join(root, "coordinator-generation-hardening.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

assert.ok(wrapper.indexOf('importScripts("coordinator-mutex-prelude.js")') < wrapper.indexOf('importScripts("background.js"'), "mutex must install before background listeners register");
assert.ok(wrapper.indexOf('importScripts("coordinator-generation-hardening.js")') > wrapper.indexOf('importScripts("background.js"'), "generation override must install after core declarations");
assert.match(wrapper, /coordinator mutex failed to initialize/i);
assert.match(wrapper, /generation hardening failed to initialize/i);

const context = vm.createContext({ globalThis: null, String, Boolean });
context.globalThis = context;
vm.runInContext('function generationMatches(expectedId, incomingId) { const expected = String(expectedId || ""); if (!expected) return true; return String(incomingId || "") === expected; }', context);
vm.runInContext(generation, context, { filename: "coordinator-generation-hardening.js" });
assert.equal(context.generationMatches("", "leftover"), false, "unarmed coordinator must fail closed");
assert.equal(context.generationMatches(null, "leftover"), false);
assert.equal(context.generationMatches("gen-1", ""), false);
assert.equal(context.generationMatches("gen-1", "gen-1"), true);
assert.equal(context.generationMatches("gen-1", "gen-2"), false);

let registered = null;
const order = [];
const preludeContext = vm.createContext({
  globalThis: null,
  Set,
  String,
  Promise,
  setTimeout,
  clearTimeout,
  chrome: {
    runtime: {
      onMessage: {
        addListener(listener) { registered = listener; }
      }
    }
  }
});
preludeContext.globalThis = preludeContext;
vm.runInContext(prelude, preludeContext, { filename: "coordinator-mutex-prelude.js" });
assert.equal(preludeContext.__AI_BRIDGE_COORDINATOR_MUTEX__.isSerializedType("AI_BRIDGE_START"), true);
assert.equal(preludeContext.__AI_BRIDGE_COORDINATOR_MUTEX__.isSerializedType("AI_BRIDGE_RESPONSE"), true);
assert.equal(preludeContext.__AI_BRIDGE_COORDINATOR_MUTEX__.isSerializedType("AI_BRIDGE_GET_STATE"), true, "client state snapshots must wait for committed coordinator mutations");

preludeContext.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  order.push(`start:${message.type}`);
  setTimeout(() => {
    order.push(`end:${message.type}`);
    sendResponse({ ok: true });
  }, message.type === "AI_BRIDGE_START" ? 20 : 0);
  return true;
});

const responseValues = [];
registered({ type: "AI_BRIDGE_START" }, {}, value => responseValues.push(value));
registered({ type: "AI_BRIDGE_RESPONSE" }, {}, value => responseValues.push(value));
await new Promise(resolve => setTimeout(resolve, 60));
assert.deepEqual(order, [
  "start:AI_BRIDGE_START",
  "end:AI_BRIDGE_START",
  "start:AI_BRIDGE_RESPONSE",
  "end:AI_BRIDGE_RESPONSE"
], "response must not overtake START arming");
assert.equal(responseValues.length, 2);

console.log("v1.16.3 coordinator hardening regression checks passed.");
