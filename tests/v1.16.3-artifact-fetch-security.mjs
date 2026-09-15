import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hardeningSource = fs.readFileSync(path.join(root, "artifact-fetch-runtime-hardening.js"), "utf8");
const wrapperSource = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

assert.ok(
  wrapperSource.includes('importScripts("artifact-fetch-runtime-hardening.js")'),
  "service worker must load artifact fetch hardening"
);
assert.match(
  wrapperSource,
  /__AI_BRIDGE_ARTIFACT_FETCH_SECURITY__\?\.credentials\s*!==\s*"omit"[\s\S]*throw new Error/,
  "service-worker bootstrap must fail closed if artifact hardening does not initialize"
);

const permissions = new Set(manifest.host_permissions || []);
assert.equal(permissions.has("https://*.microsoft.com/*"), false, "broad Microsoft wildcard must stay removed");
assert.equal(permissions.has("https://*.x.ai/*"), false, "broad x.ai wildcard must stay removed");
assert.equal(permissions.has("https://copilot.microsoft.com/*"), true, "supported Copilot origin must remain available");
assert.equal(permissions.has("https://assets.grok.com/*"), true, "Grok asset origin must remain available");
assert.equal(permissions.has("https://assets.grokusercontent.com/*"), true, "Grok generated-artifact CDN must remain available");

const calls = [];
let nextResponse = null;

function headers(values = {}) {
  const normalized = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return { get(name) { return normalized.get(String(name).toLowerCase()) ?? null; } };
}

const context = vm.createContext({
  URL,
  AbortController,
  Uint8Array,
  btoa,
  setTimeout,
  clearTimeout,
  console,
  fetch: async (url, options) => {
    calls.push({ url, options });
    if (!nextResponse) throw new Error("test did not configure a response");
    return nextResponse;
  }
});

// Match the real load order: background.js declares these globals first and
// the isolated hardening module must replace those bindings afterwards.
vm.runInContext(`
  function artifactFetchHostAllowed() { return "legacy-host-check"; }
  async function fetchArtifactInBackground() { return { legacy: true }; }
`, context);
vm.runInContext(hardeningSource, context, { filename: "artifact-fetch-runtime-hardening.js" });

assert.notEqual(context.artifactFetchHostAllowed("https://chatgpt.com/file"), "legacy-host-check");
assert.equal(context.artifactFetchHostAllowed("https://chatgpt.com/file"), true);
assert.equal(context.artifactFetchHostAllowed("https://files.oaiusercontent.com/file"), true);
assert.equal(context.artifactFetchHostAllowed("https://assets.grok.com/file"), true);
assert.equal(context.artifactFetchHostAllowed("https://assets.grokusercontent.com/file"), true);
assert.equal(context.artifactFetchHostAllowed("https://x.ai/file"), true);
assert.equal(context.artifactFetchHostAllowed("https://api.x.ai/file"), true);
assert.equal(context.artifactFetchHostAllowed("https://evil.x.ai/file"), false, "x.ai sibling subdomains must not inherit permission");
assert.equal(context.artifactFetchHostAllowed("https://login.microsoft.com/file"), false, "unrelated Microsoft sibling must be rejected");
assert.equal(context.artifactFetchHostAllowed("https://copilot.microsoft.com:8443/file"), false, "non-standard HTTPS ports must be rejected");
assert.equal(context.artifactFetchHostAllowed("http://chatgpt.com/file"), false, "HTTP must be rejected");
assert.equal(context.artifactFetchHostAllowed("https://user:pass@chatgpt.com/file"), false, "userinfo URLs must be rejected");

nextResponse = {
  ok: true,
  status: 200,
  url: "https://files.oaiusercontent.com/result.bin",
  headers: headers({ "content-length": "3", "content-type": "application/octet-stream" }),
  async arrayBuffer() { return Uint8Array.from([1, 2, 3]).buffer; }
};

const artifact = await context.fetchArtifactInBackground(
  "https://chatgpt.com/backend-api/files/download?id=signed",
  "../output.bin",
  ""
);
assert.equal(artifact.size, 3);
assert.equal(artifact.name, ".._output.bin", "artifact filename remains sanitized");
assert.equal(artifact.dataBase64, "AQID");
assert.equal(calls.length, 1);
assert.equal(calls[0].options.credentials, "omit", "background artifact fetch must never send cookies");
assert.equal(calls[0].options.referrerPolicy, "no-referrer", "provider URL must not receive extension/page referrer data");
assert.equal(calls[0].options.cache, "no-store");
assert.equal(calls[0].options.redirect, "follow");
assert.ok(calls[0].options.signal, "fetch must retain the abort timeout");

nextResponse = {
  ok: true,
  status: 200,
  url: "https://attacker.example/result.bin",
  headers: headers({ "content-length": "3" }),
  async arrayBuffer() { return Uint8Array.from([1, 2, 3]).buffer; }
};
await assert.rejects(
  () => context.fetchArtifactInBackground("https://chatgpt.com/file", "output.bin", ""),
  /redirected off the HTTPS allowlist/i,
  "final redirect target must be revalidated"
);

const callsBeforeRejectedInput = calls.length;
await assert.rejects(
  () => context.fetchArtifactInBackground("https://login.microsoft.com/file", "output.bin", ""),
  /host is not permitted/i
);
assert.equal(calls.length, callsBeforeRejectedInput, "rejected origins must never reach fetch() at all");

assert.equal(context.__AI_BRIDGE_ARTIFACT_FETCH_SECURITY__?.credentials, "omit");
assert.equal(context.__AI_BRIDGE_ARTIFACT_FETCH_SECURITY__?.finalUrlRevalidation, true);

console.log("v1.16.3 artifact fetch security regression checks passed.");
