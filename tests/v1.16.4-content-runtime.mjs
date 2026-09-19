import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "content-runtime-prelude.js"), "utf8");

let registered = null;
let nextTimer = 1;
const cleared = [];
const nativeIntervals = [];
const outbound = [];
const context = {
  window: null,
  clearInterval(handle) { cleared.push(handle); },
  Promise,
  Map,
  String,
  Number,
  URL,
  location: { hostname: "chatgpt.com", href: "https://chatgpt.com/" },
  document: { querySelectorAll() { return []; } },
  getComputedStyle() { return { visibility: "visible", display: "block" }; },
  setTimeout,
  chrome: {
    runtime: {
      async sendMessage(message) {
        outbound.push(message);
        return { ok: true };
      },
      onMessage: {
        addListener(listener) { registered = listener; }
      }
    }
  }
};
context.window = context;
context.setInterval = function(callback, delay) {
  nativeIntervals.push({ callback, delay });
  return nextTimer++;
};
vm.createContext(context);
vm.runInContext(source, context, { filename: "content-runtime-prelude.js" });

assert.equal(context.__AI_BRIDGE_CONTENT_RUNTIME_PRELUDE__.version, "1.18.0");
assert.equal(context.__AI_BRIDGE_CONTENT_RUNTIME_PRELUDE__.sendIdempotency, true);
assert.equal(context.__AI_BRIDGE_CONTENT_RUNTIME_PRELUDE__.promptEchoFilter, true);
assert.equal(context.__AI_BRIDGE_CONTENT_RUNTIME_PRELUDE__.providerSendAcknowledgement, true);

context.chrome.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
  sendResponse({ ok: true, ready: true, version: "1.14.0" });
  return false;
});
let pong = null;
registered({ type: "AI_BRIDGE_PING" }, {}, value => { pong = value; });
assert.equal(pong.version, "1.18.0");
assert.equal(pong.runtimeVersion, "1.18.0");

function monitor() {}
const timer = context.setInterval(monitor, 650);
assert.equal(timer, 1);
assert.equal(context.__AI_BRIDGE_MONITOR_TIMER__, 1, "prelude must own the monitor timer handle");
assert.equal(nativeIntervals.length, 1);

// Simulate reinjection: the old monitor must be cleared before a new runtime is
// allowed to create another one.
context.__AI_BRIDGE_CONTENT_RUNTIME_PRELUDE__ = { version: "old" };
vm.runInContext(source, context, { filename: "content-runtime-prelude.js" });
assert.ok(cleared.includes(1), "reinjection must stop the previous monitor timer");

console.log("v1.17.1 content runtime prelude regression passed.");
