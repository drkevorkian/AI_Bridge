import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "content-runtime-recovery-hardening.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");
const prelude = fs.readFileSync(path.join(root, "content-runtime-prelude.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

const requiredStack = [
  "content-runtime-prelude.js",
  "content-artifact-security-prelude.js",
  "content-completion-guard.js",
  "content-response-delivery-hardening.js",
  "content.js"
];

assert.match(
  wrapper,
  /importScripts\("background\.js"\);[\s\S]*?importScripts\("content-runtime-recovery-hardening\.js"\)/,
  "content runtime recovery hardening must wrap the base listener helper before coordinator overlays use it"
);
assert.match(wrapper, /expectedVersionFromManifest\s*!==\s*true/);
assert.match(wrapper, /injectsFullManifestStack\s*!==\s*true/);
assert.match(wrapper, /rejectsBareContentRecovery\s*!==\s*true/);
assert.match(
  prelude,
  /getManifest\?\.\(\)\.version|String\(chrome\?\.runtime\?\.getManifest\?\.\(\)\.version/,
  "content runtime prelude must derive its reported version from the installed manifest"
);

const providerRegistration = manifest.content_scripts.find(entry => Array.isArray(entry?.js) && entry.js.includes("content.js"));
assert.ok(providerRegistration, "manifest must declare the provider content runtime stack");
assert.deepEqual(providerRegistration.js, requiredStack,
  "manifest provider stack must retain every hardening prelude before content.js");

let mode = "current";
let reloadCalls = 0;
let executeCalls = 0;
let injectedFiles = null;

const context = vm.createContext({
  console,
  Object,
  Array,
  String,
  Boolean,
  Number,
  Error,
  Promise,
  Date,
  setTimeout,
  clearTimeout,
  __AI_BRIDGE_AGENT_CAPABILITIES__: {
    version: 1,
    providerFamilyForUrl(url) {
      return String(url).startsWith("https://chatgpt.com/") ? { id: "chatgpt" } : null;
    }
  },
  ensureTabListener: async () => ({ ok: true, version: "legacy-base" }),
  chrome: {
    runtime: {
      getManifest() { return manifest; }
    },
    tabs: {
      async sendMessage() {
        if (mode === "missing") throw new Error("no receiver");
        if (mode === "stale") return { ok: true, version: "1.14.0" };
        return { ok: true, version: manifest.version, runtimeVersion: manifest.version };
      },
      async get() {
        return { id: 77, status: "complete", url: "https://chatgpt.com/c/example" };
      },
      async reload() {
        reloadCalls += 1;
        mode = "current";
      }
    },
    scripting: {
      async executeScript(details) {
        executeCalls += 1;
        injectedFiles = details?.files;
        mode = "current";
      }
    }
  }
});
context.globalThis = context;
vm.runInContext(source, context, { filename: "content-runtime-recovery-hardening.js" });

// A healthy full runtime must be accepted as-is. Production previously compared
// this 1.17.1 ping against background.js's stale 1.14.0 constant and reloaded it.
mode = "current";
reloadCalls = 0;
executeCalls = 0;
let pong = await context.ensureTabListener(77);
assert.equal(pong.runtimeVersion, manifest.version);
assert.equal(reloadCalls, 0, "healthy current runtime must not be reloaded");
assert.equal(executeCalls, 0, "healthy current runtime must not be reinjected");

// A responding legacy/bare runtime gets one reload so Chrome can install the
// current manifest stack naturally. If that succeeds, do not reinject again.
mode = "stale";
reloadCalls = 0;
executeCalls = 0;
pong = await context.ensureTabListener(77);
assert.equal(pong.runtimeVersion, manifest.version);
assert.equal(reloadCalls, 1, "stale runtime must reload once");
assert.equal(executeCalls, 0, "successful manifest reload must not need manual reinjection");

// A tab with no listener (for example, open before extension installation) must
// recover with the complete manifest stack, never bare content.js.
mode = "missing";
reloadCalls = 0;
executeCalls = 0;
injectedFiles = null;
pong = await context.ensureTabListener(77);
assert.equal(pong.runtimeVersion, manifest.version);
assert.equal(reloadCalls, 0, "missing listener should not require a destructive reload");
assert.equal(executeCalls, 1, "missing listener must receive one recovery injection");
assert.deepEqual(Array.from(injectedFiles || []), requiredStack,
  "recovery injection must include every manifest hardening layer in order");

assert.equal(context.__AI_BRIDGE_CONTENT_RECOVERY_V1__?.expectedVersionFromManifest, true);
assert.equal(context.__AI_BRIDGE_CONTENT_RECOVERY_V1__?.injectsFullManifestStack, true);
assert.equal(context.__AI_BRIDGE_CONTENT_RECOVERY_V1__?.rejectsBareContentRecovery, true);

console.log("content-runtime-recovery-hardening: ok");
