import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relative) { return fs.readFileSync(path.join(root, relative), "utf8"); }
function size(relative) { return fs.statSync(path.join(root, relative)).size; }

assert.ok(size("content.js") > 20000, "content.js appears truncated");
assert.ok(size("background.js") > 150000, "background.js appears truncated");
assert.ok(size("dashboard.js") > 60000, "dashboard.js appears truncated");
assert.ok(size("content-completion-guard.js") > 8000, "content completion guard appears truncated");
assert.ok(size("human-input-runtime-hardening.js") > 4000, "human-input hardening appears truncated");
assert.ok(size("content-runtime-prelude.js") > 4000, "content runtime prelude appears truncated");
assert.ok(size("content-artifact-security-prelude.js") > 1000, "content artifact security prelude appears truncated");
assert.ok(size("manual-relay-runtime-hardening.js") > 1500, "manual relay hardening appears truncated");
assert.ok(size("dashboard-focus.css") > 3000, "Focus layout stylesheet appears truncated");
assert.ok(size("update-runtime-hardening.js") > 2500, "immutable updater hardening appears truncated");
assert.ok(size("worker-fetch-security-prelude.js") > 700, "worker fetch credential guard appears truncated");

const content = read("content.js");
for (const marker of [
  "async function monitor()",
  "async function captureArtifacts(node)",
  "AI_BRIDGE_PING",
  "AI_BRIDGE_SEND",
  "AI_BRIDGE_CAPTURE_LATEST",
  "chrome.runtime.onMessage.addListener",
  "function safeQueryAll(",
  "function authenticatedLocalArtifactAllowed(",
  "observed: true",
  "candidateSignature"
]) assert.ok(content.includes(marker), `content.js missing critical marker: ${marker}`);

const background = read("background.js");
for (const marker of [
  "async function ensureTabListener(tabId)", "AI_BRIDGE_RESPONSE", "AI_BRIDGE_FORCE_RELAY",
  "responseCommitQueue", "requireBoundSessionTab", "AI_BRIDGE_FETCH_ARTIFACT"
]) assert.ok(background.includes(marker), `background.js missing critical marker: ${marker}`);

const manifest = JSON.parse(read("manifest.json"));
assert.equal(manifest.version, "1.17.1", "debug/security release must be versioned as 1.17.1 for this finalize release");
assert.ok(Number(manifest.minimum_chrome_version) >= 106, "minimum Chrome must cover Promise-based Identity APIs");
assert.equal(manifest.content_security_policy?.extension_pages,
  "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "extension pages must retain the explicit fail-closed CSP");
assert.ok(!manifest.host_permissions.includes("https://x.ai/*"), "x.ai host permission must stay removed");
assert.ok(!manifest.host_permissions.includes("https://api.x.ai/*"), "api.x.ai host permission must stay removed");
assert.ok(!manifest.host_permissions.includes("https://oauth2.googleapis.com/*"), "undocumented Google Web OAuth token exchange host must stay removed");

const scripts = manifest.content_scripts?.[0]?.js || [];
assert.deepEqual(scripts, [
  "content-runtime-prelude.js", "content-artifact-security-prelude.js",
  "content-completion-guard.js", "content-response-delivery-hardening.js", "content.js"
], "manifest content-script safety stack/order changed unexpectedly");
for (const script of scripts) assert.equal(fs.existsSync(path.join(root, script)), true, `manifest content script is missing: ${script}`);

const reconnect = read("reconnect-runtime-hardening.js");
assert.match(reconnect, /EXPECTED_CONTENT_VERSION\s*=\s*"1\.17\.1"/, "reconnect runtime version drifted from manifest");
assert.match(reconnect, /recovery:\s*"clean-reload"/);
assert.doesNotMatch(reconnect, /chrome\.scripting\.executeScript/);

const prelude = read("content-runtime-prelude.js");
assert.match(prelude, /RUNTIME_VERSION\s*=\s*"1\.17\.1"/);
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

const workerFetch = read("worker-fetch-security-prelude.js");
assert.match(workerFetch, /httpCredentials:\s*"omit"/);
assert.match(workerFetch, /loadsBeforeCoordinator:\s*true/);

const updater = read("update-runtime-hardening.js");
assert.match(updater, /immutableCommitPin:\s*true/);
assert.match(updater, /commits\/main/);
assert.match(updater, /storage\.session/);
assert.match(updater, /credentials:\s*"omit"/);
assert.match(updater, /codeload\.github\.com\/\$\{OWNER\}\/\$\{REPO\}\/zip\/\$\{sha\}/);

const mutex = read("coordinator-mutex-prelude.js");
assert.match(mutex, /version:\s*6/);
assert.match(mutex, /artifactProvenanceGate:\s*true/);
assert.match(mutex, /artifactProvenanceSupportsDynamicSides:/);
assert.match(mutex, /validateArtifactFetchRequest/);

const wrapper = read("background-wrapper.js");
for (const requiredModule of [
  "coordinator-mutex-prelude.js", "worker-fetch-security-prelude.js", "artifact-fetch-runtime-hardening.js",
  "update-runtime-hardening.js", "manual-relay-runtime-hardening.js", "coordinator-generation-hardening.js",
  "human-input-runtime-hardening.js", "watchdog-runtime-hardening.js", "reconnect-runtime-hardening.js",
  "agent-capabilities.js", "coordinator-dynamic-agents.js", "coordinator-dynamic-semantics.js", "provider-health-runtime.js", "viewpoint-runtime.js"
]) assert.ok(wrapper.includes(`importScripts("${requiredModule}")`), `service worker is not loading ${requiredModule}`);

const mutexIndex = wrapper.indexOf('importScripts("coordinator-mutex-prelude.js")');
const workerFetchIndex = wrapper.indexOf('importScripts("worker-fetch-security-prelude.js")');
const backgroundIndex = wrapper.indexOf('importScripts("background.js")');
const artifactIndex = wrapper.indexOf('importScripts("artifact-fetch-runtime-hardening.js")');
const updateIndex = wrapper.indexOf('importScripts("update-runtime-hardening.js")');
const helperIndex = wrapper.indexOf('importScripts("completion-runtime-hardening.js", "oauth-runtime-hardening.js", "power.js")');
assert.ok(mutexIndex >= 0 && mutexIndex < workerFetchIndex, "coordinator mutex must load before worker network guard");
assert.ok(workerFetchIndex < backgroundIndex, "worker credential guard must load before background.js");
assert.ok(backgroundIndex < artifactIndex, "artifact hardening must load after background.js");
assert.ok(artifactIndex < updateIndex && updateIndex < helperIndex, "artifact/update privileged paths must be hardened before helper modules");

const textExtensions = new Set([".js", ".mjs", ".json", ".html", ".css", ".md", ".yml", ".yaml"]);
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", ".venv", "venv", "dist", "build"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) { walk(absolute); continue; }
    if (!entry.isFile() || !textExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    const text = fs.readFileSync(absolute, "utf8");
    assert.notEqual(text.trim(), "see-local-file", `${path.relative(root, absolute)} contains a placeholder instead of source code`);
    assert.notEqual(text.trim(), "placeholder", `${path.relative(root, absolute)} contains a placeholder instead of source code`);
  }
}
walk(root);
console.log("repository integrity checks passed.");
