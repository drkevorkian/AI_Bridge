import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const power = fs.readFileSync(path.join(root, "power.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");
const html = fs.readFileSync(path.join(root, "dashboard.html"), "utf8");
const popupHtml = fs.readFileSync(path.join(root, "popup.html"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} missing`);
  const sigEnd = src.indexOf(")", start);
  let depth = 0;
  let i = src.indexOf("{", sigEnd);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`${name} unclosed`);
}

assert.equal(manifest.version, "1.16.0");
assert.equal(manifest.oauth2, undefined);
assert.equal(manifest.background.service_worker, "background-wrapper.js");
assert.ok(manifest.permissions.includes("power"));
assert.ok(manifest.permissions.includes("identity"));
assert.ok(manifest.permissions.includes("alarms"));
assert.match(html, /v1\.16\.0/);
assert.match(popupHtml, /v1\.16\.0/);
assert.match(readme, /Current version: 1\.16\.0/);
assert.match(readme, /cryptographically random/);
assert.match(readme, /requestKeepAwake/);
assert.match(background, /CONTENT_VERSION = "1\.14\.0"/);
assert.match(background, /STATE_VERSION = 3/);
assert.match(background, /GOOGLE_OAUTH_STATE_KEY/);
assert.match(background, /OAUTH_STATE_TTL_MS = 10 \* 60 \* 1000/);
assert.match(background, /createOauthCsrfState/);
assert.match(background, /oauthStateMatches/);
assert.match(background, /Refusing the Google token/);
assert.match(background, /chrome\.storage\.session\.set\(\{ \[GOOGLE_OAUTH_STATE_KEY\]/);
assert.doesNotMatch(background, /chrome\.storage\.local\.set\(\{ \[GOOGLE_OAUTH_STATE_KEY\]/);
assert.doesNotMatch(background, /chrome\.storage\.sync\.set\(\{ \[GOOGLE_OAUTH_STATE_KEY\]/);
assert.doesNotMatch(background, /chrome\.storage\.local\.set\(\{ \[GOOGLE_TOKEN_SESSION_KEY\]/);
assert.match(background, /untrusted evidence\/data/);
assert.match(background, /untrusted teammate\/output data/);
assert.match(background, /untrusted teammate output/);
assert.match(background, /pickDriveSettingsFile/);
assert.match(background, /HTTP 409/);
assert.match(background, /driveWriteChain/);
assert.match(background, /enqueueGoogleAuth/);
assert.match(wrapper, /importScripts\("background\.js",\s*"oauth-runtime-hardening\.js",\s*"power\.js"\)/);
assert.match(power, /requestKeepAwake\("system"\)/);
assert.doesNotMatch(power, /requestKeepAwake\("display"\)/);
assert.match(power, /awaitingHuman/);
assert.match(power, /onStartup/);
assert.match(background, /DRIVE_APP_DATA_SCOPE = "https:\/\/www\.googleapis\.com\/auth\/drive\.appdata"/);
assert.doesNotMatch(background, /googleapis\.com\/auth\/drive"/);

const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
assert.equal(ids.length, new Set(ids).size, `duplicate ids: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);

const sandbox = {
  URL,
  URLSearchParams,
  Date,
  JSON,
  Math,
  Number,
  String,
  Boolean,
  Array,
  Object,
  Set,
  RegExp,
  Uint8Array,
  crypto: globalThis.crypto,
  DRIVE_SETTINGS_NAME: "ai-bridge-settings.json"
};
vm.runInNewContext(
  [
    extractFunction(background, "parseImplicitOAuthRedirect"),
    extractFunction(background, "createOauthCsrfState"),
    extractFunction(background, "oauthStateWellFormed"),
    extractFunction(background, "oauthStateMatches"),
    extractFunction(background, "pickDriveSettingsFile"),
    "this.parseImplicitOAuthRedirect = parseImplicitOAuthRedirect;",
    "this.createOauthCsrfState = createOauthCsrfState;",
    "this.oauthStateWellFormed = oauthStateWellFormed;",
    "this.oauthStateMatches = oauthStateMatches;",
    "this.pickDriveSettingsFile = pickDriveSettingsFile;"
  ].join("\n"),
  sandbox
);

const stateA = sandbox.createOauthCsrfState();
const stateB = sandbox.createOauthCsrfState();
assert.equal(stateA.length, 64);
assert.equal(sandbox.oauthStateWellFormed(stateA), true);
assert.notEqual(stateA, stateB);
assert.equal(sandbox.oauthStateMatches(stateA, stateA), true);
assert.equal(sandbox.oauthStateMatches(stateA, stateB), false);
assert.equal(sandbox.oauthStateMatches("", stateA), false);
assert.equal(sandbox.oauthStateMatches(stateA, "x".repeat(64)), false);
assert.equal(sandbox.oauthStateWellFormed("abcd"), false);
assert.equal(sandbox.oauthStateWellFormed("a".repeat(64)), true);

const host = "abcdefghijklmnopqrstuvwxyz.chromiumapp.org";
const withState = `https://${host}/#access_token=ya29.abcdefghijklmnopqrstuvwxyz012345&token_type=Bearer&expires_in=3600&state=${stateA}`;
const parsed = sandbox.parseImplicitOAuthRedirect(withState, host);
assert.equal(parsed.token, "ya29.abcdefghijklmnopqrstuvwxyz012345");
assert.equal(parsed.state, stateA);
assert.equal(sandbox.oauthStateMatches(stateA, parsed.state), true);
const stolen = sandbox.parseImplicitOAuthRedirect(
  `https://${host}/#access_token=ya29.abcdefghijklmnopqrstuvwxyz012345&state=${stateB}`,
  host
);
assert.equal(sandbox.oauthStateMatches(stateA, stolen.state), false);

const newest = sandbox.pickDriveSettingsFile([
  { id: "oldFileId12", name: "ai-bridge-settings.json", modifiedTime: "2026-01-01T00:00:00.000Z" },
  { id: "newFileId12", name: "ai-bridge-settings.json", modifiedTime: "2026-09-15T00:00:00.000Z" },
  { id: "otherFile12", name: "not-settings.json", modifiedTime: "2026-12-01T00:00:00.000Z" }
]);
assert.equal(newest.id, "newFileId12");
assert.equal(sandbox.pickDriveSettingsFile([]), null);
assert.equal(sandbox.pickDriveSettingsFile([{ id: "nope", name: "x" }]), null);

console.log("v1.16 oauth-state + power + drive regression ok");
