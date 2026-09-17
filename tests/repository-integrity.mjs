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

assert.ok(size("content.js") > 20000, "content.js appears truncated");
assert.ok(size("background.js") > 150000, "background.js appears truncated");
assert.ok(size("dashboard.js") > 60000, "dashboard.js appears truncated");
assert.ok(size("content-completion-guard.js") > 8000, "content completion guard appears truncated");
assert.ok(size("human-input-runtime-hardening.js") > 4000, "human-input hardening appears truncated");
assert.ok(size("content-runtime-prelude.js") > 4000, "content runtime prelude appears truncated");
assert.ok(size("content-artifact-security-prelude.js") > 1000, "content artifact security prelude appears truncated");
assert.ok(size("manual-relay-runtime-hardening.js") > 500, "manual relay hardening appears truncated");
assert.ok(size("dashboard-focus.css") > 3000, "Focus layout stylesheet appears truncated");

const content = read("content.js");
for (const marker of [
  "async function monitor()",
  "async function captureArtifacts(node)",
  "AI_BRIDGE_PING",
  "AI_BRIDGE_SEND",
  "AI_BRIDGE_CAPTURE_LATEST",
  "chrome.runtime.onMessage.addListener"
]) {
  assert.ok(content.includes(marker), `content.js missing critical marker: ${marker}`);
}

const background = read("background.js");
for (const marker of [
  "async function ensureTabListener(tabId)",
  "AI_BRIDGE_RESPONSE",
  "AI_BRIDGE_FORCE_RELAY",
  "responseCommitQueue",
  "requireBoundSessionTab",
  "AI_BRIDGE_FETCH_ARTIFACT"
]) {
  assert.ok(background.includes(marker), `background.js missing critical marker: ${marker}`);
}

const manifest = JSON.parse(read("manifest.json"));
assert.equal(manifest.version, "1.17.0", "debug/security release must remain versioned as 1.17.0 until the next release bump");
assert.ok(Number(manifest.minimum_chrome_version) >= 106, "minimum Chrome must cover Promise-based Identity APIs");
assert.equal(
  manifest.content_security_policy?.extension_pages,
  "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "extension pages must retain the explicit fail-closed CSP"
);
assert.ok(!manifest.host_permissions.includes("https://x.ai/*"), "x.ai host permission must stay removed");
assert.ok(!manifest.host_permissions.includes("https://api.x.ai/*"), "api.x.ai host permission must stay removed");
assert.ok(!manifest.host_permissions.includes("https://oauth2.googleapis.com/*"), "undocumented Google Web OAuth token exchange host must stay removed");

const scripts = manifest.content_scripts?.[0]?.js || [];
assert.deepEqual(
  scripts,
  [
    "content-runtime-prelude.js",
    "content-artifact-security-prelude.js",
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
assert.match(reconnect, /EXPECTED_CONTENT_VERSION\s*=\s*"1\.17\.0"/, "reconnect runtime version drifted from manifest");
assert.match(reconnect, /recovery:\s*"clean-reload"/, "reconnect must use a clean isolated-world reload strategy");
assert.doesNotMatch(reconnect, /chrome\.scripting\.executeScript/, "reconnect must not stack content wrappers through live reinjection");

const prelude = read("content-runtime-prelude.js");
assert.match(prelude, /RUNTIME_VERSION\s*=\s*"1\.17\.0"/);
assert.match(prelude, /__AI_BRIDGE_MONITOR_TIMER__/);
assert.match(prelude, /waitForProviderSendAcknowledgement/);
assert.match(prelude, /providerSendAcknowledgement:\s*true/);

const contentArtifactSecurity = read("content-artifact-security-prelude.js");
assert.match(contentArtifactSecurity, /defaultCredentials:\s*"omit"/);
assert.match(contentArtifactSecurity, /current-chatgpt-interpreter-download-only/);

const artifactHardening = read("artifact-fetch-runtime-hardening.js");
assert.match(artifactHardening, /credentials:\s*"omit"/);
assert.match(artifactHardening, /streamedSizeLimit:\s*true/);
assert.match(artifactHardening, /finalUrlRevalidation:\s*true/);
assert.doesNotMatch(artifactHardening, /"x\.ai"|"api\.x\.ai"/);

const wrapper = read("background-wrapper.js");
for (const requiredModule of [
  "artifact-fetch-runtime-hardening.js",
  "manual-relay-runtime-hardening.js",
  "coordinator-generation-hardening.js",
  "human-input-runtime-hardening.js",
  "watchdog-runtime-hardening.js",
  "reconnect-runtime-hardening.js"
]) {
  assert.ok(wrapper.includes(`importScripts("${requiredModule}")`), `service worker is not loading ${requiredModule}`);
}
const mutexIndex = wrapper.indexOf('importScripts("coordinator-mutex-prelude.js")');
const backgroundIndex = wrapper.indexOf('importScripts("background.js")');
const artifactIndex = wrapper.indexOf('importScripts("artifact-fetch-runtime-hardening.js")');
const helperIndex = wrapper.indexOf('importScripts("completion-runtime-hardening.js", "oauth-runtime-hardening.js", "power.js")');
assert.ok(mutexIndex >= 0 && mutexIndex < backgroundIndex, "coordinator mutex must load before background.js");
assert.ok(backgroundIndex >= 0 && backgroundIndex < artifactIndex, "artifact hardening must load immediately after background.js");
assert.ok(artifactIndex >= 0 && artifactIndex < helperIndex, "privileged artifact fetch must be hardened before other helper modules load");

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
    assert.notEqual(text.trim(), "see-local-file", `${path.relative(root, absolute)} contains a placeholder instead of source code`);
    assert.notEqual(text.trim(), "placeholder", `${path.relative(root, absolute)} contains a placeholder instead of source code`);
  }
}
walk(root);

console.log("repository integrity checks passed.");
