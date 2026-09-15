import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");
const hardening = fs.readFileSync(path.join(root, "oauth-runtime-hardening.js"), "utf8");

assert.match(
  wrapper,
  /importScripts\("background\.js",\s*"completion-runtime-hardening\.js",\s*"oauth-runtime-hardening\.js",\s*"power\.js"\)/,
  "OAuth hardening must load after completion hardening and before the power helper"
);
assert.match(hardening, /clearPendingOauthState/);
assert.match(hardening, /createdAt > Date\.now\(\)/);

let nextRecord = { createdAt: Date.now() - 1000, state: "a".repeat(64) };
let clearCount = 0;
let baseLaunchMode = "success";

const sandbox = {
  console: { warn() {} },
  Date,
  Number,
  launchGoogleWebAuth: async () => {
    if (baseLaunchMode === "fail") throw new Error("callback parser rejected redirect");
    return "token-ok";
  },
  clearPendingOauthState: async () => { clearCount += 1; },
  consumePendingOauthState: async () => nextRecord
};

vm.runInNewContext(hardening, sandbox);

// Valid session CSRF records still pass through untouched.
const valid = await sandbox.consumePendingOauthState();
assert.equal(valid, nextRecord);

// Invalid/future timestamps fail closed after the underlying one-time consume.
nextRecord = { createdAt: 0, state: "a".repeat(64) };
assert.equal(await sandbox.consumePendingOauthState(), null);
nextRecord = { createdAt: Number.NaN, state: "a".repeat(64) };
assert.equal(await sandbox.consumePendingOauthState(), null);
nextRecord = { createdAt: Date.now() + 60_000, state: "a".repeat(64) };
assert.equal(await sandbox.consumePendingOauthState(), null);

// Any failure that escapes the core OAuth launcher must remove pending state.
// This covers a successful launchWebAuthFlow return followed by parser rejection
// (for example #error=access_denied), which v1.16.0 previously left uncleared.
baseLaunchMode = "fail";
await assert.rejects(
  () => sandbox.launchGoogleWebAuth({ clientId: "123-test.apps.googleusercontent.com", interactive: true }),
  /callback parser rejected redirect/
);
assert.equal(clearCount, 1);

// Success must not invoke the cleanup fallback.
baseLaunchMode = "success";
assert.equal(await sandbox.launchGoogleWebAuth({}), "token-ok");
assert.equal(clearCount, 1);

console.log("v1.16 oauth callback cleanup hotfix regression ok");
