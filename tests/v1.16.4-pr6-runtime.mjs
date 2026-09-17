import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prelude = fs.readFileSync(path.join(root, "content-runtime-prelude.js"), "utf8");
const resend = fs.readFileSync(path.join(root, "resend-runtime-hardening.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

assert.match(wrapper, /importScripts\("resend-runtime-hardening\.js"\)/);
assert.match(wrapper, /stopBeforeReplacement !== true/);
assert.doesNotMatch(prelude, /all_frames|x\.com|queryShadowSelector/);
assert.match(prelude, /providerSendAcknowledgement:\s*true/);

// Content-runtime idempotency and exact prompt-echo suppression.
{
  const listeners = [];
  const outbound = [];
  const intervals = [];
  const location = { hostname: "chatgpt.com", href: "https://chatgpt.com/" };
  const windowObject = {
    setInterval(callback, delay) {
      intervals.push({ callback, delay });
      return intervals.length;
    }
  };
  const sandbox = {
    window: windowObject,
    clearInterval() {},
    Promise,
    Map,
    Set,
    String,
    Number,
    URL,
    Date,
    location,
    document: { querySelectorAll() { return []; } },
    getComputedStyle() { return { visibility: "visible", display: "block" }; },
    setTimeout,
    chrome: {
      runtime: {
        sendMessage: async message => {
          outbound.push(message);
          return { ok: true };
        },
        onMessage: {
          addListener(listener) { listeners.push(listener); }
        }
      }
    }
  };
  // content-runtime-prelude stores flags and the monitor handle on window, but
  // browser globals such as location/document live on the VM global object.
  Object.assign(windowObject, {
    setTimeout,
    __AI_BRIDGE_MONITOR_TIMER__: null
  });
  vm.createContext(sandbox);
  vm.runInContext(prelude, sandbox, { filename: "content-runtime-prelude.js" });

  // Register a minimal stand-in for content.js after the prelude has wrapped
  // addListener. Simulate a real provider acknowledgement by navigating to a
  // conversation URL before returning optimistic content.js success.
  let providerSubmissions = 0;
  sandbox.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "AI_BRIDGE_SEND") {
      providerSubmissions += 1;
      location.href = `https://chatgpt.com/c/${providerSubmissions}`;
      sendResponse({ ok: true, uploadedCount: 0, generationId: message.generationId });
      return true;
    }
    if (message.type === "AI_BRIDGE_PING") {
      sendResponse({ ok: true, version: "legacy" });
      return false;
    }
    return false;
  });
  assert.equal(listeners.length, 1);

  function dispatch(message) {
    return new Promise(resolve => {
      listeners[0](message, {}, resolve);
    });
  }

  let result = await dispatch({ type: "AI_BRIDGE_SEND", generationId: "gen-1", text: "hello", artifacts: [] });
  assert.equal(result.ok, true);
  assert.equal(result.sendAcknowledged, true);
  assert.equal(providerSubmissions, 1);

  result = await dispatch({ type: "AI_BRIDGE_SEND", generationId: "gen-1", text: "hello", artifacts: [] });
  assert.equal(result.ok, true);
  assert.equal(result.duplicateSend, true);
  assert.equal(providerSubmissions, 1, "same acknowledged generation must not submit to provider DOM twice");

  result = await sandbox.chrome.runtime.sendMessage({
    type: "AI_BRIDGE_RESPONSE",
    generationId: "gen-1",
    text: "  hello  "
  });
  assert.equal(result.promptEcho, true);
  assert.equal(result.ignored, true);
  assert.equal(outbound.length, 0, "exact prompt echo must not reach service worker");

  await sandbox.chrome.runtime.sendMessage({
    type: "AI_BRIDGE_RESPONSE",
    generationId: "gen-1",
    text: "hello back"
  });
  assert.equal(outbound.length, 1, "real response must pass through");

  const ping = await dispatch({ type: "AI_BRIDGE_PING" });
  assert.equal(ping.version, "1.17.0");
  assert.equal(ping.runtimeVersion, "1.17.0");
}

// Service-worker overlap guard: active generation must be stopped and observed
// idle before the replacement prompt is handed to the original sendToSide.
{
  const events = [];
  let statusCalls = 0;
  const sandbox = {
    console,
    Promise,
    Date,
    setTimeout: callback => { callback(); return 1; },
    globalThis: null,
    state: { tabA: 101 },
    tabForSide: side => side === "A" ? 101 : null,
    ensureTabListener: async tabId => { events.push(`ensure:${tabId}`); },
    sendToSide: async (side, text) => {
      events.push(`send:${side}:${text}`);
      return { ok: true };
    },
    chrome: {
      tabs: {
        sendMessage: async (_tabId, message) => {
          if (message.type === "AI_BRIDGE_GENERATION_STATUS") {
            statusCalls += 1;
            events.push(`status:${statusCalls}`);
            return { ok: true, generating: statusCalls === 1 };
          }
          if (message.type === "AI_BRIDGE_STOP_GENERATION") {
            events.push("stop");
            return { ok: true, stopped: true };
          }
          throw new Error(`unexpected message ${message.type}`);
        }
      }
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(resend, sandbox, { filename: "resend-runtime-hardening.js" });
  assert.equal(sandbox.__AI_BRIDGE_RESEND_HARDENING_V1__.stopBeforeReplacement, true);

  await sandbox.sendToSide("A", "replacement");
  assert.ok(events.indexOf("stop") >= 0);
  assert.ok(events.indexOf("stop") < events.indexOf("send:A:replacement"), "stop must precede replacement send");
  assert.ok(events.indexOf("status:2") < events.indexOf("send:A:replacement"), "idle confirmation must precede replacement send");
}

// If the page claims it is generating but exposes no usable stop control, fail
// closed instead of overlapping two generations.
{
  let baseSendCalls = 0;
  const sandbox = {
    console,
    Promise,
    Date,
    setTimeout: callback => { callback(); return 1; },
    globalThis: null,
    state: { tabA: 101 },
    tabForSide: () => 101,
    ensureTabListener: async () => {},
    sendToSide: async () => { baseSendCalls += 1; },
    chrome: {
      tabs: {
        sendMessage: async (_tabId, message) => {
          if (message.type === "AI_BRIDGE_GENERATION_STATUS") return { ok: true, generating: true };
          if (message.type === "AI_BRIDGE_STOP_GENERATION") return { ok: true, stopped: false };
          throw new Error("unexpected message");
        }
      }
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(resend, sandbox, { filename: "resend-runtime-hardening.js" });
  await assert.rejects(() => sandbox.sendToSide("A", "replacement"), /no usable Stop control/i);
  assert.equal(baseSendCalls, 0);
}

console.log("v1.17 idempotency, prompt-echo, acknowledgement, and stop-before-send regression ok");
