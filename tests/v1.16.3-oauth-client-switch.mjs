import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hardening = fs.readFileSync(path.join(root, "oauth-runtime-hardening.js"), "utf8");

let clientId = "111-old.apps.googleusercontent.com";
let tokenClearCount = 0;
let stateClearCount = 0;
let linkedValue = true;
let packaged = false;
let connectCallCount = 0;

const sandbox = {
  console: { warn() {} },
  Date,
  Number,
  DRIVE_APP_DATA_SCOPE: "https://www.googleapis.com/auth/drive.appdata",
  GOOGLE_LINKED_KEY: "bridgeGoogleLinked",
  chrome: {
    storage: {
      local: {
        set: async payload => {
          if (Object.prototype.hasOwnProperty.call(payload, "bridgeGoogleLinked")) {
            linkedValue = Boolean(payload.bridgeGoogleLinked);
          }
        }
      }
    }
  },
  launchGoogleWebAuth: async () => "legacy-token-should-never-run",
  consumePendingOauthState: async () => ({ createdAt: Date.now() - 1000 }),
  clearPendingOauthState: async () => { stateClearCount += 1; },
  clearSessionGoogleToken: async () => { tokenClearCount += 1; },
  readUserOauthClientId: async () => clientId,
  saveUserOauthClientId: async raw => {
    clientId = String(raw || "").trim();
    return { saved: Boolean(clientId), googleConfigured: Boolean(clientId) };
  },
  googleOauthPackaged: () => packaged,
  googleOauthReady: async () => packaged,
  getGoogleAccessTokenUnlocked: async () => "packaged-token",
  connectGoogleAccount: async () => {
    connectCallCount += 1;
    return { googleLinked: true, via: "packaged" };
  }
};

sandbox.globalThis = sandbox;
vm.runInNewContext(hardening, sandbox);

assert.equal(sandbox.__AI_BRIDGE_OAUTH_SECURITY__.googleImplicitFlowDisabled, true);
assert.equal(sandbox.__AI_BRIDGE_OAUTH_SECURITY__.packagedGoogleAuthUsesChromeIdentity, true);

// A legacy user-pasted Web OAuth client ID is no longer executable state. Any
// save request clears the value, cached token, pending state, and linked flag.
let result = await sandbox.saveUserOauthClientId("222-new.apps.googleusercontent.com");
assert.equal(result.saved, false);
assert.equal(result.googleLinked, false);
assert.equal(result.legacyWebClientDisabled, true);
assert.equal(clientId, "");
assert.equal(tokenClearCount, 1);
assert.equal(stateClearCount, 1);
assert.equal(linkedValue, false);

// The old launchWebAuthFlow(response_type=token) path must fail closed.
await assert.rejects(
  () => sandbox.launchGoogleWebAuth({ clientId: "anything", interactive: true }),
  /implicit flow|disabled/i
);

// Unpacked/no-manifest OAuth is a setup state, not an exception and never calls
// the underlying interactive account connection path.
packaged = false;
result = await sandbox.connectGoogleAccount();
assert.equal(result.googleLinked, false);
assert.equal(result.googleConfigured, false);
assert.equal(result.setupRequired, true);
assert.equal(result.setupKind, "chrome-extension-oauth-client");
assert.equal(result.legacyWebClientDisabled, true);
assert.match(result.setupMessage, /Chrome-Extension OAuth client/i);
assert.match(result.setupMessage, /Chrome Sync/);
assert.equal(result.driveScope, "https://www.googleapis.com/auth/drive.appdata");
assert.equal(connectCallCount, 0);

// Once a packaged Chrome-extension OAuth client exists, delegate unchanged to
// the core chrome.identity.getAuthToken path.
packaged = true;
assert.equal(await sandbox.googleOauthReady(), true);
assert.equal(await sandbox.getGoogleAccessTokenUnlocked({ interactive: true }), "packaged-token");
result = await sandbox.connectGoogleAccount();
assert.equal(result.googleLinked, true);
assert.equal(result.via, "packaged");
assert.equal(connectCallCount, 1);

console.log("v1.17 OAuth security regression ok");
