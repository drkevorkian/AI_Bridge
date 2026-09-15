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
let oauthReady = true;
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
  launchGoogleWebAuth: async () => "token-ok",
  consumePendingOauthState: async () => ({ createdAt: Date.now() - 1000 }),
  clearPendingOauthState: async () => { stateClearCount += 1; },
  clearSessionGoogleToken: async () => { tokenClearCount += 1; },
  readUserOauthClientId: async () => clientId,
  saveUserOauthClientId: async raw => {
    clientId = String(raw || "").trim();
    return { saved: Boolean(clientId), googleConfigured: Boolean(clientId) };
  },
  googleOauthReady: async () => oauthReady,
  connectGoogleAccount: async () => {
    connectCallCount += 1;
    return { googleLinked: true, via: "packaged" };
  }
};

vm.runInNewContext(hardening, sandbox);

// Saving the same non-empty client must preserve the current session.
let result = await sandbox.saveUserOauthClientId("111-old.apps.googleusercontent.com");
assert.equal(result.relinkRequired, undefined);
assert.equal(tokenClearCount, 0);
assert.equal(stateClearCount, 0);
assert.equal(linkedValue, true);

// Switching client IDs invalidates the old token/state and forces re-link.
result = await sandbox.saveUserOauthClientId("222-new.apps.googleusercontent.com");
assert.equal(result.relinkRequired, true);
assert.equal(result.googleLinked, false);
assert.equal(tokenClearCount, 1);
assert.equal(stateClearCount, 1);
assert.equal(linkedValue, false);

// A subsequent save of the same new ID must not repeatedly clear state.
result = await sandbox.saveUserOauthClientId("222-new.apps.googleusercontent.com");
assert.equal(result.relinkRequired, undefined);
assert.equal(tokenClearCount, 1);
assert.equal(stateClearCount, 1);

// Missing publisher OAuth configuration is a normal setup state, not an
// exception. It must not call the underlying interactive auth path.
oauthReady = false;
result = await sandbox.connectGoogleAccount();
assert.equal(result.googleLinked, false);
assert.equal(result.googleConfigured, false);
assert.equal(result.setupRequired, true);
assert.equal(result.setupKind, "publisher-oauth");
assert.equal(result.driveScope, "https://www.googleapis.com/auth/drive.appdata");
assert.equal(connectCallCount, 0);

// Once OAuth is configured, the wrapper must delegate unchanged to the real
// one-click Google authorization implementation.
oauthReady = true;
result = await sandbox.connectGoogleAccount();
assert.equal(result.googleLinked, true);
assert.equal(result.via, "packaged");
assert.equal(connectCallCount, 1);

console.log("v1.16.3 OAuth client-switch + link-setup regression ok");
