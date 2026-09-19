import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");
const hardening = fs.readFileSync(path.join(root, "oauth-runtime-hardening.js"), "utf8");

const backgroundIndex = wrapper.indexOf('importScripts("background.js")');
const artifactIndex = wrapper.indexOf('importScripts("artifact-fetch-runtime-hardening.js")');
const updateIndex = wrapper.indexOf('importScripts("update-runtime-hardening.js")');
const helperIndex = wrapper.indexOf('importScripts("completion-runtime-hardening.js", "oauth-runtime-hardening.js", "power.js")');
assert.ok(backgroundIndex >= 0, "coordinator source must load through the wrapper");
assert.ok(artifactIndex > backgroundIndex, "artifact hardening must replace privileged source helpers immediately after background.js");
assert.ok(updateIndex > artifactIndex, "immutable updater hardening must load after artifact hardening");
assert.ok(helperIndex > updateIndex, "OAuth/power helpers must load only after privileged network paths are hardened");
assert.match(hardening, /clearPendingOauthState/);
assert.match(hardening, /createdAt > Date\.now\(\)/);
assert.match(hardening, /googleImplicitFlowDisabled:\s*true/);

let nextRecord = { createdAt: Date.now() - 1000, state: "a".repeat(64) };
let clearCount = 0;
let legacyLaunchCount = 0;

const sandbox = {
  console: { warn() {} },
  Date,
  Number,
  launchGoogleWebAuth: async () => {
    legacyLaunchCount += 1;
    return "legacy-token-must-not-be-returned";
  },
  clearPendingOauthState: async () => { clearCount += 1; },
  consumePendingOauthState: async () => nextRecord
};
sandbox.globalThis = sandbox;

vm.runInNewContext(hardening, sandbox);

// Valid session CSRF records still pass through untouched for migration cleanup
// and any future authorization-code flow that reuses the one-time state helper.
const valid = await sandbox.consumePendingOauthState();
assert.equal(valid, nextRecord);

// Invalid/future timestamps fail closed after the underlying one-time consume.
nextRecord = { createdAt: 0, state: "a".repeat(64) };
assert.equal(await sandbox.consumePendingOauthState(), null);
nextRecord = { createdAt: Number.NaN, state: "a".repeat(64) };
assert.equal(await sandbox.consumePendingOauthState(), null);
nextRecord = { createdAt: Date.now() + 60_000, state: "a".repeat(64) };
assert.equal(await sandbox.consumePendingOauthState(), null);

// v1.17 removes the Google Web implicit flow entirely. Calling the legacy
// launcher must clear pending state and fail before the old implementation is
// reached, so an access token can never be returned in the redirect fragment.
await assert.rejects(
  () => sandbox.launchGoogleWebAuth({ clientId: "123-test.apps.googleusercontent.com", interactive: true }),
  /implicit flow|disabled/i
);
assert.equal(clearCount, 1);
assert.equal(legacyLaunchCount, 0, "disabled legacy launcher must never delegate to response_type=token implementation");

console.log("v1.17 OAuth callback/security regression ok");
