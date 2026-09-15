import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "reconnect-runtime-hardening.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

assert.match(wrapper, /importScripts\("reconnect-runtime-hardening\.js"\)/, "service worker must load reconnect hardening");
assert.match(
  source,
  /files:\s*\[\s*"content-completion-guard\.js",\s*"content-response-delivery-hardening\.js",\s*"content\.js"\s*\]/,
  "reconnect must rebuild the full content runtime in manifest order"
);
assert.match(source, /delete window\.__AI_BRIDGE_LOADED_V114__/, "reconnect must clear the stale content bootstrap sentinel after a failed ping");
assert.match(source, /delete window\.__AI_BRIDGE_COMPLETION_GUARD_V1163__/, "reconnect must reset the stale completion guard sentinel");
assert.match(source, /delete window\.__AI_BRIDGE_RESPONSE_DELIVERY_HARDENING_V1163__/, "reconnect must reset response delivery hardening before reinjection");
assert.match(source, /PING_ATTEMPTS\s*=\s*8/, "reconnect should use bounded ping retries");

function buildRuntime({ sendMessage, tab = { id: 17, status: "complete", url: "https://chatgpt.com/c/test" } } = {}) {
  const executeCalls = [];
  const reloadCalls = [];
  const context = {
    CONTENT_VERSION: "1.14.0",
    setTimeout,
    clearTimeout,
    URL,
    console,
    chrome: {
      tabs: {
        sendMessage: sendMessage || (async () => ({ ok: true, version: "1.14.0" })),
        get: async () => ({ ...tab }),
        reload: async id => { reloadCalls.push(id); }
      },
      scripting: {
        executeScript: async spec => { executeCalls.push(spec); return []; }
      }
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "reconnect-runtime-hardening.js" });
  return { context, executeCalls, reloadCalls };
}

{
  const runtime = buildRuntime();
  const pong = await runtime.context.ensureTabListener(17);
  assert.equal(pong.ok, true);
  assert.equal(runtime.executeCalls.length, 0, "healthy listeners must not be reinjected");
}

{
  let sends = 0;
  const runtime = buildRuntime({
    sendMessage: async () => {
      sends += 1;
      if (sends <= 2) throw new Error("Receiving end does not exist");
      return { ok: true, version: "1.14.0" };
    }
  });
  const pong = await runtime.context.ensureTabListener(17);
  assert.equal(pong.ok, true);
  assert.equal(runtime.executeCalls.length, 2, "failed ping must clear stale sentinels and reinject the complete content stack");
  assert.equal(typeof runtime.executeCalls[0].func, "function");
  assert.deepEqual(
    Array.from(runtime.executeCalls[1].files),
    ["content-completion-guard.js", "content-response-delivery-hardening.js", "content.js"]
  );
  assert.ok(sends >= 3, "post-injection ping must retry instead of relying on one 150ms probe");
}

{
  let sends = 0;
  const runtime = buildRuntime({
    sendMessage: async () => {
      sends += 1;
      return sends === 1
        ? { ok: true, version: "1.13.0" }
        : { ok: true, version: "1.14.0" };
    }
  });
  const pong = await runtime.context.ensureTabListener(17);
  assert.equal(pong.version, "1.14.0");
  assert.deepEqual(runtime.reloadCalls, [17], "version mismatch must reload the provider tab before reinjection");
  assert.equal(runtime.executeCalls.length, 2);
}

{
  const runtime = buildRuntime({
    sendMessage: async () => { throw new Error("no listener"); },
    tab: { id: 17, status: "complete", url: "https://example.com/" }
  });
  await assert.rejects(
    () => runtime.context.ensureTabListener(17),
    /not on a supported AI site/i
  );
  assert.equal(runtime.executeCalls.length, 0, "unsupported pages must fail closed without script injection");
}

console.log("v1.16.3 reconnect hardening regression passed");
