import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function size(relative) {
  return fs.statSync(path.join(root, relative)).size;
}

// Conservative lower bounds: normal refactors remain possible, while a
// one-line placeholder/truncated upload can no longer pass CI just because it
// is syntactically valid JavaScript.
assert.ok(size("content.js") > 20000, "content.js appears truncated");
assert.ok(size("background.js") > 150000, "background.js appears truncated");
assert.ok(size("dashboard.js") > 60000, "dashboard.js appears truncated");
assert.ok(size("content-completion-guard.js") > 8000, "content completion guard appears truncated");
assert.ok(size("human-input-runtime-hardening.js") > 4000, "human-input hardening appears truncated");
assert.ok(size("content-runtime-prelude.js") > 1000, "content runtime prelude appears truncated");

const content = read("content.js");
for (const marker of [
  "async function monitor()",
  "async function captureArtifacts(node)",
  "AI_BRIDGE_PING",
  "AI_BRIDGE_SEND",
  "chrome.runtime.onMessage.addListener"
]) {
  assert.ok(content.includes(marker), `content.js missing critical marker: ${marker}`);
}

const background = read("background.js");
for (const marker of [
  "async function ensureTabListener(tabId)",
  "AI_BRIDGE_RESPONSE",
  "responseCommitQueue",
  "requireBoundSessionTab",
  "AI_BRIDGE_FETCH_ARTIFACT"
]) {
  assert.ok(background.includes(marker), `background.js missing critical marker: ${marker}`);
}

const manifest = JSON.parse(read("manifest.json"));
assert.equal(manifest.version, "1.16.4", "runtime hardening release must remain versioned as 1.16.4");
const scripts = manifest.content_scripts?.[0]?.js || [];
assert.deepEqual(
  scripts,
  [
    "content-runtime-prelude.js",
    "content-completion-guard.js",
    "content-response-delivery-hardening.js",
    "content.js"
  ],
  "manifest content-script safety stack/order changed unexpectedly"
);
for (const script of scripts) {
  assert.equal(fs.existsSync(path.join(root, script)), true, `manifest content script is missing: ${script}`);
}

const reconnect = read("reconnect-runtime-hardening.js");
assert.match(reconnect, /EXPECTED_CONTENT_VERSION\s*=\s*"1\.16\.4"/, "reconnect runtime version drifted from manifest");
assert.match(reconnect, /recovery:\s*"clean-reload"/, "reconnect must use a clean isolated-world reload strategy");
assert.doesNotMatch(reconnect, /chrome\.scripting\.executeScript/, "reconnect must not stack content wrappers through live reinjection");

const prelude = read("content-runtime-prelude.js");
assert.match(prelude, /RUNTIME_VERSION\s*=\s*"1\.16\.4"/);
assert.match(prelude, /__AI_BRIDGE_MONITOR_TIMER__/);

const wrapper = read("background-wrapper.js");
assert.match(
  wrapper,
  /importScripts\("background\.js",\s*"completion-runtime-hardening\.js",\s*"oauth-runtime-hardening\.js",\s*"power\.js"\)/,
  "established service-worker bootstrap chain changed unexpectedly"
);
for (const requiredModule of [
  "artifact-fetch-runtime-hardening.js",
  "coordinator-generation-hardening.js",
  "human-input-runtime-hardening.js",
  "watchdog-runtime-hardening.js",
  "reconnect-runtime-hardening.js"
]) {
  assert.ok(wrapper.includes(`importScripts("${requiredModule}")`), `service worker is not loading ${requiredModule}`);
}
assert.ok(
  wrapper.indexOf('importScripts("coordinator-mutex-prelude.js")') < wrapper.indexOf('importScripts("background.js"'),
  "coordinator mutation prelude must load before background.js registers its message listener"
);

const textExtensions = new Set([".js", ".mjs", ".json", ".html", ".css", ".md", ".yml", ".yaml"]);
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", ".venv", "venv", "dist", "build"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolute);
      continue;
    }
    if (!entry.isFile() || !textExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    const text = fs.readFileSync(absolute, "utf8");
    assert.notEqual(
      text.trim(),
      "see-local-file",
      `${path.relative(root, absolute)} contains a placeholder instead of source code`
    );
    assert.notEqual(
      text.trim(),
      "placeholder",
      `${path.relative(root, absolute)} contains a placeholder instead of source code`
    );
  }
}
walk(root);

console.log("repository integrity checks passed.");
