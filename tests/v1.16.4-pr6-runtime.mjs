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

// Content-runtime idempotency and exact prompt-echo suppression.
{
  const listeners = [];
  const outbound = [];
  const intervals = [];
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
    String,
    Number,
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
  vm.createContext(sandbox);
  vm.runInContext(prelude, sandbox, { filename: "content-runtime-prelude.js" });

  // Register a minimal stand-in for content.js after the prelude has wrapped
  // addListener. A successful first send is remembered; the same generation is
  // then answered locally without invoking the provider send path again.
  let providerSubmissions = 0;
  sandbox.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "AI_BRIDGE_SEND") {
      providerSubmissions += 1;
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
      const keepAlive = listeners[0](message, {}, resolve);
      if (keepAlive !== true && message.type !== "AI_BRIDGE_SEND") {
        // synchronous listeners already resolved through sendResponse
      }
    });
  }

  let result = await dispatch({ type: "AI_BRIDGE_SEND", generationId: "gen-1", text: "hello", artifacts: [] });
  assert.equal(result.ok, true);
  assert.equal(providerSubmissions, 1);

  result = await dispatch({ type: "AI_BRIDGE_SEND", generationId: "gen-1", text: "hello", artifacts: [] });
  assert.equal(result.ok, true);
  assert.equal(result.duplicateSend, true);
  assert.equal(providerSubmissions, 1, "same generation must not submit to provider DOM twice");

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
  assert.equal(ping.version, "1.16.4");
  assert.equal(ping.runtimeVersion, "1.16.4");
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

console.log("v1.16.4 PR6 idempotency, prompt-echo, and stop-before-send regression ok");
