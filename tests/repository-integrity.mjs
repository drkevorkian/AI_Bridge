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
const scripts = manifest.content_scripts?.[0]?.js || [];
assert.deepEqual(
  scripts,
  [
    "content-completion-guard.js",
    "content-response-delivery-hardening.js",
    "content.js"
  ],
  "manifest content-script safety stack/order changed unexpectedly"
);

const reconnect = read("reconnect-runtime-hardening.js");
for (const marker of [
  '"content-completion-guard.js"',
  '"content-response-delivery-hardening.js"',
  '"content.js"'
]) {
  assert.ok(reconnect.includes(marker), `reconnect runtime missing required script: ${marker}`);
}

const wrapper = read("background-wrapper.js");
assert.match(
  wrapper,
  /importScripts\("background\.js",\s*"completion-runtime-hardening\.js",\s*"oauth-runtime-hardening\.js",\s*"power\.js"\)/,
  "established service-worker bootstrap chain changed unexpectedly"
);
assert.ok(
  wrapper.includes('importScripts("human-input-runtime-hardening.js")'),
  "human-input hardening is not loaded"
);
assert.ok(
  wrapper.includes('importScripts("reconnect-runtime-hardening.js")'),
  "reconnect hardening is not loaded"
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
  }
}
walk(root);

console.log("repository integrity checks passed.");
