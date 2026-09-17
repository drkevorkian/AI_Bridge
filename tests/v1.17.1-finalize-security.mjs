import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

const workerPrelude = read("worker-fetch-security-prelude.js");
const wrapper = read("background-wrapper.js");
const background = read("background.js");
const mutex = read("coordinator-mutex-prelude.js");
const content = read("content.js");
const release = read("dashboard-release.js");
const focusCss = read("dashboard-focus.css");

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

assert.match(background, /credentials:\s*"omit"/);
assert.doesNotMatch(background, /credentials:\s*"include"/);
assert.match(background, /referrerPolicy:\s*"no-referrer"/);
assert.match(background, /readResponseBytesBounded/);
assert.doesNotMatch(background, /host === "x\.ai"/);
assert.doesNotMatch(background, /endsWith\("\.microsoft\.com"\)/);
assert.match(background, /ALLOWED_CLOUD_LAYOUTS = new Set\(\[