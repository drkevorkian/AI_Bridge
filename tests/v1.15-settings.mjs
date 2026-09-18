import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const dashboardJs = fs.readFileSync(path.join(root, "dashboard.js"), "utf8");
const dashboardRelease = fs.readFileSync(path.join(root, "dashboard-release.js"), "utf8");
const html = fs.readFileSync(path.join(root, "dashboard.html"), "utf8");
const css = fs.readFileSync(path.join(root, "dashboard.css"), "utf8");
const popupHtml = fs.readFileSync(path.join(root, "popup.html"), "utf8");
const popupJs = fs.readFileSync(path.join(root, "popup.js"), "utf8");
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

assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(manifest.oauth2, undefined, "do not ship a placeholder OAuth client ID");
assert.equal(JSON.stringify(manifest).includes("YOUR_"), false);
assert.equal(JSON.stringify(manifest).includes("PLACEHOLDER"), false);
for (const permission of ["identity", "downloads", "notifications", "alarms"]) {
  assert.ok(manifest.permissions.includes(permission));
}
for (const host of [
  "https://api.github.com/*",
  "https://raw.githubusercontent.com/*",
  "https://codeload.github.com/*"
]) {
  assert.ok(manifest.host_permissions.includes(host));
}
assert.ok(manifest.host_permissions.every(rule => rule.startsWith("https://")));

for (const id of [
  "viewSessionBtn", "viewSettingsBtn", "sessionView", "settingsView",
  "themeSelect", "googleClientId", "saveGoogleClientId", "extensionIdValue",
  "redirectUriValue", "copyExtensionId", "copyRedirectUri", "checkUpdates",
  "downloadUpdate", "autoCheckUpdates", "updateStatus", "installedVersionPill",
  "cloudConnect"
]) {
  assert.match(html, new RegExp(`id="${id}"`), `dashboard is missing ${id}`);
}
assert.match(html, /dashboard-release\.js/);
assert.equal((html.match(/id="themeSelect"/g) || []).length, 1);
assert.match(css, /\.view-tabs/);
assert.match(css, /\.view-tab\.active/);
assert.match(popupHtml, /id="openSettings"/);
assert.match(popupJs, /hash: "settings"/);
assert.doesNotMatch(dashboardJs, /innerHTML/);
assert.doesNotMatch(dashboardRelease, /innerHTML|eval\s*\(|new Function/);
assert.match(dashboardRelease, /getManifest\(\)\?\.version/);
assert.match(dashboardJs, /function currentPanePct\(/);
assert.match(dashboardJs, /function showDashboardView\(/);
assert.match(dashboardJs, /AI_BRIDGE_SAVE_GOOGLE_CLIENT_ID/);
assert.match(dashboardJs, /AI_BRIDGE_CHECK_UPDATES/);
assert.match(dashboardJs, /AI_BRIDGE_DOWNLOAD_UPDATE/);
assert.match(dashboardJs, /AI_BRIDGE_SET_AUTO_UPDATE/);
assert.match(popupJs, /AI_BRIDGE_OPEN_DASHBOARD/);

assert.match(background, /STATE_VERSION = 3/);
assert.match(background, /UPDATE_ALARM = "ai-bridge-update-check"/);
assert.match(background, /periodInMinutes: 1440/);
assert.doesNotMatch(background, /launchWebAuthFlow/);
assert.match(background, /Google Drive Web implicit OAuth is disabled/);
assert.doesNotMatch(background, /response_type:\s*"token"/);
assert.match(background, /chrome\.storage\.session/);
assert.match(background, /GOOGLE_TOKEN_SESSION_KEY/);
assert.match(background, /clearSessionGoogleToken/);
assert.match(background, /redirect:\s*"error"/);
assert.match(background, /requireExtensionPage\(sender, "Save Google client ID"\)/);
assert.match(background, /requireExtensionPage\(sender, "Check for updates"\)/);
assert.match(background, /requireExtensionPage\(sender, "Download update"\)/);
assert.match(background, /requireExtensionPage\(sender, "Set auto-update"\)/);
assert.match(background, /saveAs:\s*true/);

const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
assert.equal(ids.length, new Set(ids).size, `duplicate ids: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);
const popupIds = [...popupHtml.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
assert.equal(popupIds.length, new Set(popupIds).size, `duplicate popup ids: ${popupIds.filter((id, i) => popupIds.indexOf(id) !== i)}`);

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
  GITHUB_OWNER: "drkevorkian",
  GITHUB_REPO: "AI_Bridge"
};
vm.runInNewContext(
  [
    extractFunction(background, "normalizeOauthClientId"),
    extractFunction(background, "googleAuthUrlAllowed"),
    extractFunction(background, "parseImplicitOAuthRedirect"),
    extractFunction(background, "githubUrlAllowed"),
    extractFunction(background, "parseVersionParts"),
    extractFunction(background, "compareVersions"),
    "this.normalizeOauthClientId = normalizeOauthClientId;",
    "this.googleAuthUrlAllowed = googleAuthUrlAllowed;",
    "this.parseImplicitOAuthRedirect = parseImplicitOAuthRedirect;",
    "this.githubUrlAllowed = githubUrlAllowed;",
    "this.compareVersions = compareVersions;"
  ].join("\n"),
  sandbox
);

const okId = "1234567890-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com";
assert.equal(sandbox.normalizeOauthClientId(okId), okId);
assert.equal(sandbox.normalizeOauthClientId("  " + okId + "  "), okId);
assert.throws(() => sandbox.normalizeOauthClientId(""), /Paste/);
assert.throws(() => sandbox.normalizeOauthClientId("PLACEHOLDER.apps.googleusercontent.com"), /look like/);
assert.throws(() => sandbox.normalizeOauthClientId("not-a-client-id"), /look like/);

assert.equal(sandbox.googleAuthUrlAllowed("https://accounts.google.com/o/oauth2/v2/auth?client_id=x"), true);
assert.equal(sandbox.googleAuthUrlAllowed("http://accounts.google.com/o/oauth2/v2/auth"), false);
assert.equal(sandbox.googleAuthUrlAllowed("https://evil.example/o/oauth2/v2/auth"), false);
assert.equal(sandbox.googleAuthUrlAllowed("https://user:pass@accounts.google.com/o/oauth2/v2/auth"), false);

const host = "abcdefghijklmnopqrstuvwxyz.chromiumapp.org";
const goodRedirect = `https://${host}/#access_token=ya29.abcdefghijklmnopqrstuvwxyz012345&token_type=Bearer&expires_in=3600`;
const parsed = sandbox.parseImplicitOAuthRedirect(goodRedirect, host);
assert.equal(parsed.token, "ya29.abcdefghijklmnopqrstuvwxyz012345");
assert.ok(parsed.expiresAt > Date.now());
assert.throws(() => sandbox.parseImplicitOAuthRedirect(goodRedirect.replace("https://", "http://"), host), /not HTTPS/);
assert.throws(() => sandbox.parseImplicitOAuthRedirect(goodRedirect, "other.chromiumapp.org"), /host rejected/);

const gh = sandbox.githubUrlAllowed;
assert.equal(gh("https://raw.githubusercontent.com/drkevorkian/AI_Bridge/main/manifest.json"), true);
assert.equal(gh("https://api.github.com/repos/drkevorkian/AI_Bridge/releases/latest"), true);
assert.equal(gh("https://codeload.github.com/drkevorkian/AI_Bridge/zip/refs/heads/main"), true);
assert.equal(gh("http://raw.githubusercontent.com/drkevorkian/AI_Bridge/main/manifest.json"), false);
assert.equal(gh("https://raw.githubusercontent.com/evil/AI_Bridge/main/manifest.json"), false);
assert.equal(gh("https://user:pass@raw.githubusercontent.com/drkevorkian/AI_Bridge/main/manifest.json"), false);

assert.equal(sandbox.compareVersions("1.16.4", "1.16.3"), 1);
assert.equal(sandbox.compareVersions("1.16.4", "1.16.4"), 0);
assert.equal(sandbox.compareVersions("1.16.3", "1.16.4"), -1);
assert.throws(() => sandbox.compareVersions("v1.16.4", "1.16.4"), /rejected/);

console.log("v1.15 settings/OAuth/update regression ok");
