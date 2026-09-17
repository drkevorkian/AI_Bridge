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
assert.equal(manifest.version, "1.17.1", "runtime stability release must bump the extension version");

const manifestScripts = manifest.content_scripts?.[0]?.js || [];
assert.deepEqual(manifestScripts, [
  "content-runtime-prelude.js",
  "content-artifact-security-prelude.js",
  "content-completion-guard.js",
  "content-response-delivery-hardening.js",
  "content.js"
]);
for (const script of manifestScripts) {
  assert.equal(fs.existsSync(path.join(root, script)), true, `manifest content script must exist: ${script}`);
}

assert.ok(content.length > 20000, `content.js is unexpectedly small/truncated (${content.length} bytes)`);
assert.match(content, /chrome\.runtime\.onMessage\.addListener/);
assert.match(content, /msg\.type\s*===\s*"AI_BRIDGE_PING"/);
assert.match(content, /msg\.type\s*===\s*"AI_BRIDGE_SEND"/);
assert.match(content, /async function monitor\(/);
assert.match(content, /\}\)\(\);\s*$/);

assert.match(source, /EXPECTED_CONTENT_VERSION\s*=\s*"1\.17\.1"/);
assert.match(source, /recovery:\s*"clean-reload"/);
assert.match(source, /PING_ATTEMPTS\s*=\s*12/);
assert.doesNotMatch(source, /chrome\.scripting\.executeScript/, "reconnect must not inject another wrapper stack into a live content world");
assert.doesNotMatch(source, /clearStaleContentBootstrapGuards/, "sentinel deletion must not be used as a substitute for a clean isolated world");

function buildRuntime({ sendMessage, tab = { id: 17, status: "complete", url: "https://chatgpt.com/c/test" } } = {}) {
  const reloadCalls = [];
  let sends = 0;
  const context = {
    setTimeout,
    clearTimeout,
    URL,
    console,
    chrome: {
      tabs: {
        sendMessage: async (...args) => {
          sends += 1;
          return sendMessage ? sendMessage(sends, ...args) : { ok: true, version: "1.17.1" };
        },
        get: async () => ({ ...tab }),
        reload: async id => { reloadCalls.push(id); }
      }
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "reconnect-runtime-hardening.js" });
  return { context, reloadCalls, get sends() { return sends; } };
}

{
  const runtime = buildRuntime();
  const pong = await runtime.context.ensureTabListener(17);
  assert.equal(pong.ok, true);
  assert.equal(runtime.reloadCalls.length, 0, "current listeners must not trigger a page reload");
}

{
  const runtime = buildRuntime({
    sendMessage: async sends => {
      if (sends === 1) throw new Error("Receiving end does not exist");
      return { ok: true, version: "1.17.1" };
    }
  });
  const pong = await runtime.context.ensureTabListener(17);
  assert.equal(pong.ok, true);
  assert.deepEqual(runtime.reloadCalls, [17], "missing listener must recover through one clean page reload");
  assert.ok(runtime.sends >= 2);
}

{
  const runtime = buildRuntime({
    sendMessage: async sends => sends === 1
      ? { ok: true, version: "1.14.0" }
      : { ok: true, version: "1.17.1" }
  });
  const pong = await runtime.context.ensureTabListener(17);
  assert.equal(pong.version, "1.17.1");
  assert.deepEqual(runtime.reloadCalls, [17], "version mismatch must discard the stale isolated world");
}

{
  const runtime = buildRuntime({
    sendMessage: async () => { throw new Error("no listener"); },
    tab: { id: 17, status: "complete", url: "https://example.com/" }
  });
  await assert.rejects(() => runtime.context.ensureTabListener(17), /not on a supported AI site/i);
  assert.equal(runtime.reloadCalls.length, 0, "unsupported pages must fail closed without reload/injection");
}

console.log("v1.17.1 reconnect/content integrity regression passed");
