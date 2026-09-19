import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const prelude = read("content-runtime-prelude.js");
const reconnect = read("reconnect-runtime-hardening.js");
const wrapper = read("background-wrapper.js");

// Keep source-era literals for backwards-compatible harnesses while deriving the
// actual runtime identity from the installed extension manifest in production.
assert.match(prelude, /RUNTIME_VERSION\s*=\s*"1\.17\.1"/);
assert.match(prelude, /INSTALLED_RUNTIME_VERSION\s*=\s*String\(chrome\?\.runtime\?\.getManifest\?\.\(\)\.version\s*\|\|\s*RUNTIME_VERSION\)/);
assert.match(prelude, /runtimeVersion:\s*INSTALLED_RUNTIME_VERSION/);
assert.match(prelude, /versionFromManifest:\s*true/);

assert.match(reconnect, /EXPECTED_CONTENT_VERSION\s*=\s*"1\.17\.1"/);
assert.match(reconnect, /installedContentVersion\s*=\s*\(\)\s*=>\s*String\(chrome\?\.runtime\?\.getManifest\?\.\(\)\.version\s*\|\|\s*EXPECTED_CONTENT_VERSION\)/);
assert.match(reconnect, /pong\?\.runtimeVersion\s*\|\|\s*pong\?\.version/);
assert.match(reconnect, /contentRuntimeVersionFromManifest:\s*true/);
assert.match(reconnect, /recovery:\s*"clean-reload"/);
assert.doesNotMatch(reconnect, /chrome\.scripting\.executeScript/,
  "reconnect must keep clean-reload recovery instead of stacking scripts into a live isolated world");

// Production ordering matters: reconnect-runtime-hardening loads last and is the
// authoritative ensureTabListener implementation. Do not insert a weaker helper
// after it or reintroduce the legacy bare-content.js recovery path.
const backgroundIndex = wrapper.indexOf('importScripts("background.js")');
const reconnectIndex = wrapper.lastIndexOf('importScripts("reconnect-runtime-hardening.js")');
assert.ok(backgroundIndex >= 0 && reconnectIndex > backgroundIndex,
  "reconnect hardening must load after the legacy background helper");
assert.equal(wrapper.slice(reconnectIndex).includes('importScripts("'), true,
  "reconnect import must remain present at the end of the worker bootstrap");
assert.doesNotMatch(wrapper, /content-runtime-recovery-hardening\.js/,
  "do not layer a redundant recovery implementation ahead of authoritative reconnect hardening");

// Simulate a future extension version bump without editing the fallback literal.
// A content runtime that reports the installed manifest version must be accepted
// immediately rather than reloaded as stale.
const futureManifestVersion = "9.9.9";
let reloadCalls = 0;
const context = vm.createContext({
  console,
  Object,
  Array,
  String,
  Number,
  Boolean,
  Error,
  Promise,
  Date,
  setTimeout,
  clearTimeout,
  chrome: {
    runtime: {
      getManifest() { return { ...manifest, version: futureManifestVersion }; }
    },
    tabs: {
      async sendMessage() {
        return {
          ok: true,
          version: "1.17.1",
          runtimeVersion: futureManifestVersion
        };
      },
      async get() {
        return { id: 42, status: "complete", url: "https://chatgpt.com/c/example" };
      },
      async reload() {
        reloadCalls += 1;
      }
    }
  }
});
context.globalThis = context;
vm.runInContext(reconnect, context, { filename: "reconnect-runtime-hardening.js" });

const pong = await context.ensureTabListener(42);
assert.equal(pong.runtimeVersion, futureManifestVersion);
assert.equal(reloadCalls, 0,
  "manifest-current content runtime must not be reloaded merely because the source-era fallback version is older");
assert.equal(context.__AI_BRIDGE_RECONNECT_HARDENING__?.contentRuntimeVersion, futureManifestVersion);
assert.equal(context.__AI_BRIDGE_RECONNECT_HARDENING__?.contentRuntimeVersionFromManifest, true);
assert.equal(context.__AI_BRIDGE_RECONNECT_HARDENING__?.recovery, "clean-reload");

console.log("content-runtime-version-contract: ok");
