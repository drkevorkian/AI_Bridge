import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

const workerPrelude = read("worker-fetch-security-prelude.js");
const wrapper = read("background-wrapper.js");
const mutex = read("coordinator-mutex-prelude.js");
const content = read("content.js");
const release = read("dashboard-release.js");
const focusCss = read("dashboard-focus.css");

// Worker transport boundary -------------------------------------------------
const calls = [];
const sandbox = vm.createContext({
  URL,
  globalThis: null,
  location: { href: "chrome-extension://example/background-wrapper.js" },
  fetch: async (input, init) => {
    calls.push({ input, init });
    return { ok: true };
  }
});
sandbox.globalThis = sandbox;
vm.runInContext(workerPrelude, sandbox, { filename: "worker-fetch-security-prelude.js" });

await sandbox.fetch("https://chatgpt.com/backend-api/example", {
  credentials: "include",
  headers: { Authorization: "Bearer explicit-token" }
});
assert.equal(calls[0].init.credentials, "omit", "HTTP(S) worker fetch must never carry ambient credentials");
assert.equal(calls[0].init.headers.Authorization, "Bearer explicit-token", "explicit Authorization headers remain intact");
assert.equal(sandbox.__AI_BRIDGE_WORKER_FETCH_SECURITY_V1__.httpCredentials, "omit");
assert.ok(
  wrapper.indexOf('importScripts("worker-fetch-security-prelude.js")') < wrapper.indexOf('importScripts("background.js")'),
  "credential guard must load before coordinator source"
);

// Artifact provenance -------------------------------------------------------
assert.match(mutex, /version:\s*5/);
assert.match(mutex, /artifactProvenanceGate:\s*true/);
assert.match(mutex, /message\.observed !== true/);
assert.match(mutex, /generationIdBySide/);
assert.match(mutex, /candidateSignature/);
assert.match(mutex, /parsed\.protocol !== "https:"/);
assert.match(content, /observed:\s*true/);
assert.match(content, /generationId:\s*currentGenerationId/);
assert.match(content, /candidateSignature/);
assert.match(content, /authenticatedLocalArtifactAllowed/);
assert.match(content, /credentials:\s*authenticatedLocalArtifactAllowed\(url\) \? "include" : "omit"/);
assert.match(content, /if \(\/\^https:\/\/i\.test\(url\)\)/);

// Focus accessibility -------------------------------------------------------
assert.match(release, /role", "tabpanel"/);
assert.match(release, /aria-labelledby/);
assert.match(release, /aria-controls/);
assert.match(release, /aria-hidden/);
assert.match(release, /panel\.inert = !active/);
assert.match(release, /aria-label", "Focus View Navigation"/);
assert.match(focusCss, /@media \(max-width: 720px\)/);
assert.match(focusCss, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
assert.match(focusCss, /min-height:\s*44px/);
assert.match(focusCss, /:focus-visible/);

console.log("v1.17.1 final security + Focus accessibility checks passed.");
