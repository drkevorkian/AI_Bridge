import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "reconnect-runtime-hardening.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

assert.match(wrapper, /importScripts\("reconnect-runtime-hardening\.js"\)/, "service worker must load reconnect hardening");

const manifestScripts = manifest.content_scripts?.[0]?.js || [];
assert.ok(manifestScripts.length >= 2, "manifest must declare the content runtime");
for (const script of manifestScripts) {
  assert.equal(fs.existsSync(path.join(root, script)), true, `manifest content script must exist: ${script}`);
}

// Reconnect must inject the exact same ordered runtime Chrome declares in the
// manifest. This catches both missing files and accidental drift between normal
// page load and recovery.
const filesMatch = source.match(/files:\s*\[([\s\S]*?)\]/);
assert.ok(filesMatch, "reconnect hardening must inject a content-script file list");
const reconnectScripts = [...filesMatch[1].matchAll(/"([^"]+\.js)"/g)].map(match => match[1]);
assert.deepEqual(reconnectScripts, manifestScripts, "reconnect runtime must exactly match manifest content_scripts order");

// A syntactically valid but truncated content.js is catastrophic: Chrome can
// inject it without ever registering AI_BRIDGE_PING. Guard against that exact
// production failure instead of checking syntax alone.
assert.ok(content.length > 20000, `content.js is unexpectedly small/truncated (${content.length} bytes)`);
assert.match(content, /chrome\.runtime\.onMessage\.addListener/, "content.js must register the runtime message listener");
assert.match(content, /msg\.type\s*===\s*"AI_BRIDGE_PING"/, "content.js must implement AI_BRIDGE_PING");
assert.match(content, /msg\.type\s*===\s*"AI_BRIDGE_SEND"/, "content.js must implement AI_BRIDGE_SEND");
assert.match(content, /async function monitor\(/, "content.js must include response monitoring");
assert.match(content, /\}\)\(\);\s*$/, "content.js must contain its closing IIFE");

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
        executeScript: async spec => {
          if (Array.isArray(spec.files)) {
            for (const file of spec.files) {
              if (!fs.existsSync(path.join(root, file))) throw new Error(`Could not load file: ${file}`);
            }
          }
          executeCalls.push(spec);
          return [];
        }
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
  assert.deepEqual(Array.from(runtime.executeCalls[1].files), manifestScripts);
  assert.ok(sends >= 3, "post-injection ping must retry instead of relying on one probe");
}

{
  const runtime = buildRuntime({
    sendMessage: async () => { throw new Error("no listener"); },
    tab: { id: 17, status: "complete", url: "https://example.com/" }
  });
  await assert.rejects(() => runtime.context.ensureTabListener(17), /not on a supported AI site/i);
  assert.equal(runtime.executeCalls.length, 0, "unsupported pages must fail closed without script injection");
}

console.log("v1.16.3 reconnect/content integrity regression passed");
