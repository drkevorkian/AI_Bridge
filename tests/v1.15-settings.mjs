import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const dashboardJs = fs.readFileSync(path.join(root, "dashboard.js"), "utf8");
const html = fs.readFileSync(path.join(root, "dashboard.html"), "utf8");
const css = fs.readFileSync(path.join(root, "dashboard.css"), "utf8");
const popupHtml = fs.readFileSync(path.join(root, "popup.html"), "utf8");
const popupJs = fs.readFileSync(path.join(root, "popup.js"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
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

assert.equal(manifest.version, "1.15.0");
assert.equal(manifest.oauth2, undefined, "do not ship a placeholder OAuth client ID");
assert.equal(JSON.stringify(manifest).includes("YOUR_"), false);
assert.equal(JSON.stringify(manifest).includes("PLACEHOLDER"), false);
assert.ok(manifest.permissions.includes("identity"));
assert.ok(manifest.permissions.includes("downloads"));
assert.ok(manifest.permissions.includes("notifications"));
assert.ok(manifest.permissions.includes("alarms"));
assert.ok(manifest.host_permissions.includes("https://api.github.com/*"));
assert.ok(manifest.host_permissions.includes("https://raw.githubusercontent.com/*"));
assert.ok(manifest.host_permissions.includes("https://codeload.github.com/*"));
assert.ok(manifest.host_permissions.every(rule => rule.startsWith("https://")));

assert.match(html, /v1\.15\.0/);
assert.match(html, /id="viewSessionBtn"/);
assert.match(html, /id="viewSettingsBtn"/);
assert.match(html, /id="sessionView"/);
assert.match(html, /id="settingsView"/);
assert.match(html, /id="themeSelect"/);
assert.match(html, /id="googleClientId"/);
assert.match(html, /id="saveGoogleClientId"/);
assert.match(html, /id="extensionIdValue"/);
assert.match(html, /id="redirectUriValue"/);
assert.match(html, /id="copyExtensionId"/);
assert.match(html, /id="copyRedirectUri"/);
assert.match(html, /id="checkUpdates"/);
assert.match(html, /id="downloadUpdate"/);
assert.match(html, /id="autoCheckUpdates"/);
assert.match(html, /id="updateStatus"/);
assert.match(html, /id="installedVersionPill"/);
assert.match(html, /id="cloudConnect"/);
assert.equal((html.match(/id="themeSelect"/g) || []).length, 1);
assert.match(css, /\.view-tabs/);
assert.match(css, /\.view-tab\.active/);
assert.match(popupHtml, /v1\.15\.0/);
assert.match(popupHtml, /id="openSettings"/);
assert.match(popupJs, /hash: "settings"/);
assert.doesNotMatch(dashboardJs, /innerHTML/);
assert.match(dashboardJs, /function currentPanePct\(/);
assert.match(dashboardJs, /function showDashboardView\(/);
assert.match(dashboardJs, /AI_BRIDGE_SAVE_GOOGLE_CLIENT_ID/);
assert.match(dashboardJs, /AI_BRIDGE_CHECK_UPDATES/);
assert.match(dashboardJs, /AI_BRIDGE_DOWNLOAD_UPDATE/);
assert.match(dashboardJs, /AI_BRIDGE_SET_AUTO_UPDATE/);
assert.match(popupJs, /AI_BRIDGE_OPEN_DASHBOARD/);

assert.match(content, /version: "1\.14\.0"/);
assert.match(content, /__AI_BRIDGE_LOADED_V114__/);
assert.match(background, /CONTENT_VERSION = "1\.14\.0"/);
assert.match(background, /STATE_VERSION = 3/);
assert.match(background, /UPDATE_ALARM = "ai-bridge-update-check"/);
assert.match(background, /periodInMinutes: 1440/);
assert.match(background, /launchWebAuthFlow/);
assert.match(background, /https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
assert.match(background, /response_type: "token"/);
assert.match(background, /chrome\.storage\.session/);
assert.match(background, /GOOGLE_TOKEN_SESSION_KEY/);
assert.match(background, /clearSessionGoogleToken/);
assert.match(background, /redirect:\s*"error"/);
assert.match(background, /requireExtensionPage\(sender, "Save Google client ID"\)/);
assert.match(background, /requireExtensionPage\(sender, "Check for updates"\)/);
assert.match(background, /requireExtensionPage\(sender, "Download update"\)/);
assert.match(background, /requireExtensionPage\(sender, "Set auto-update"\)/);
assert.match(background, /openDashboard\(msg\.hash\)/);
assert.match(background, /saveAs:\s*true/);
assert.doesNotMatch(readme, /not yet on main/i);
assert.match(readme, /Current version: 1\.15\.0/);
assert.match(readme, /Web application/);
assert.match(readme, /drive\.appdata/);

const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
assert.equal(ids.length, new Set(ids).size, `duplicate ids: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);

const popupIds = [...popupHtml.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
assert.equal(popupIds.length, new Set(popupIds).size, `duplicate popup ids: ${popupIds.filter((id, i) => popupIds.indexOf(id) !== i)}`);

assert.match(background, /CONTENT_SCRIPT_MESSAGE_TYPES = new Set\(\["AI_BRIDGE_FETCH_ARTIFACT", "AI_BRIDGE_RESPONSE"\]\)/);

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
    "this.parseVersionParts = parseVersionParts;",
    "this.compareVersions = compareVersions;"
  ].join("\n"),
  sandbox
);

const okId = "1234567890-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com";
assert.equal(sandbox.normalizeOauthClientId(okId), okId);
assert.equal(sandbox.normalizeOauthClientId("  " + okId + "  "), okId);
assert.equal(sandbox.normalizeOauthClientId("", { emptyOk: true }), "");
assert.throws(() => sandbox.normalizeOauthClientId(""), /Paste/);
assert.throws(() => sandbox.normalizeOauthClientId("PLACEHOLDER.apps.googleusercontent.com"), /look like/);
assert.throws(() => sandbox.normalizeOauthClientId("123-placeholder.apps.googleusercontent.com"), /placeholder/i);
assert.throws(() => sandbox.normalizeOauthClientId("not-a-client-id"), /look like/);
assert.throws(() => sandbox.normalizeOauthClientId("123-abc.apps.googleusercontent.com.evil.com"), /look like/);

assert.equal(sandbox.googleAuthUrlAllowed("https://accounts.google.com/o/oauth2/v2/auth?client_id=x"), true);
assert.equal(sandbox.googleAuthUrlAllowed("https://accounts.google.com/o/oauth2/auth?client_id=x"), true);
assert.equal(sandbox.googleAuthUrlAllowed("http://accounts.google.com/o/oauth2/v2/auth"), false);
assert.equal(sandbox.googleAuthUrlAllowed("https://evil.example/o/oauth2/v2/auth"), false);
assert.equal(sandbox.googleAuthUrlAllowed("https://accounts.google.com.evil.com/o/oauth2/v2/auth"), false);
assert.equal(sandbox.googleAuthUrlAllowed("https://user:pass@accounts.google.com/o/oauth2/v2/auth"), false);
assert.equal(sandbox.googleAuthUrlAllowed("https://www.googleapis.com/o/oauth2/v2/auth"), false);

const host = "abcdefghijklmnopqrstuvwxyz.chromiumapp.org";
const goodRedirect = `https://${host}/#access_token=ya29.abcdefghijklmnopqrstuvwxyz012345&token_type=Bearer&expires_in=3600`;
const parsed = sandbox.parseImplicitOAuthRedirect(goodRedirect, host);
assert.equal(parsed.token, "ya29.abcdefghijklmnopqrstuvwxyz012345");
assert.ok(parsed.expiresAt > Date.now());
assert.throws(() => sandbox.parseImplicitOAuthRedirect(goodRedirect.replace("https://", "http://"), host), /not HTTPS/);
assert.throws(() => sandbox.parseImplicitOAuthRedirect(goodRedirect, "other.chromiumapp.org"), /host rejected/);
assert.throws(() => sandbox.parseImplicitOAuthRedirect(`https://${host}/#error=access_denied`, host), /denied/);
assert.throws(() => sandbox.parseImplicitOAuthRedirect(`https://${host}/#access_token=short`, host), /did not return a token/);
assert.throws(() => sandbox.parseImplicitOAuthRedirect(`https://${host}/#access_token=ya29.space tokenvalueeeee`, host), /rejected/);

const gh = sandbox.githubUrlAllowed;
assert.equal(gh("https://raw.githubusercontent.com/drkevorkian/AI_Bridge/main/manifest.json"), true);
assert.equal(gh("https://api.github.com/repos/drkevorkian/AI_Bridge/releases/latest"), true);
assert.equal(gh("https://codeload.github.com/drkevorkian/AI_Bridge/zip/refs/heads/main"), true);
assert.equal(gh("https://codeload.github.com/drkevorkian/AI_Bridge/zip/refs/tags/v1.15.0"), true);
assert.equal(gh("http://raw.githubusercontent.com/drkevorkian/AI_Bridge/main/manifest.json"), false);
assert.equal(gh("https://raw.githubusercontent.com/evil/AI_Bridge/main/manifest.json"), false);
assert.equal(gh("https://raw.githubusercontent.com/drkevorkian/AI_Bridge/dev/manifest.json"), false);
assert.equal(gh("https://github.com/drkevorkian/AI_Bridge/archive/refs/heads/main.zip"), false);
assert.equal(gh("https://user:pass@raw.githubusercontent.com/drkevorkian/AI_Bridge/main/manifest.json"), false);
assert.equal(gh("https://raw.githubusercontent.com.evil.com/drkevorkian/AI_Bridge/main/manifest.json"), false);

assert.equal(sandbox.compareVersions("1.15.0", "1.14.0"), 1);
assert.equal(sandbox.compareVersions("1.15.0", "1.15.0"), 0);
assert.equal(sandbox.compareVersions("1.14.9", "1.15.0"), -1);
assert.equal(sandbox.compareVersions("2.0.0", "1.15.0"), 1);
assert.throws(() => sandbox.compareVersions("v1.15.0", "1.15.0"), /rejected/);
assert.throws(() => sandbox.compareVersions("", "1.15.0"), /rejected/);

const cloudSandbox = {
  URL,
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
  SIDES: ["A", "B", "C"],
  INFINITE_TURNS: -1,
  WORK_MODES: new Set(["relay", "collaborate", "compete", "parallel", "review", "mesh"]),
  ALLOWED_CLOUD_THEMES: new Set(["blizzard", "ghostwhite", "midnight", "slate", "light", "solarized", "ocean", "terminal"]),
  CLOUD_SETTINGS_VERSION: 1,
  DEFAULT_CHECKPOINT_EVERY: 5,
  DEFAULT_STUCK_MINUTES: 30
};
vm.runInNewContext(
  [
    "function normalizeWorkMode(raw) { const value = String(raw || 'relay').toLowerCase(); return WORK_MODES.has(value) ? value : 'relay'; }",
    "function normalizeMaxTurns(raw) { const value = Number(raw); if (value === -1) return -1; if (!Number.isInteger(value) || value < 1 || value > 10000) throw new Error('bad turns'); return value; }",
    extractFunction(background, "clampCloudPane"),
    extractFunction(background, "clampCheckpointEvery"),
    extractFunction(background, "clampStuckTimeoutMinutes"),
    extractFunction(background, "sanitizeHistoryForCloud"),
    extractFunction(background, "sanitizeCloudSettings"),
    extractFunction(background, "assertCloudSettingsSafe"),
    "this.sanitizeCloudSettings = sanitizeCloudSettings;",
    "this.assertCloudSettingsSafe = assertCloudSettingsSafe;"
  ].join("\n"),
  cloudSandbox
);

const dirty = cloudSandbox.sanitizeCloudSettings({
  theme: "ocean",
  googleClientId: okId,
  clientId: okId,
  accessToken: "ya29.should-never-sync",
  refreshToken: "1//should-never-sync",
  recoveryCheckpoint: { text: "secret restart summary", cycleCount: 9 },
  token: "ya29.nope",
  jobA: "Lead"
});
assert.equal(dirty.theme, "ocean");
assert.equal(dirty.jobA, "Lead");
assert.equal(dirty.googleClientId, undefined);
assert.equal(dirty.clientId, undefined);
assert.equal(dirty.accessToken, undefined);
assert.equal(dirty.refreshToken, undefined);
assert.equal(dirty.recoveryCheckpoint, undefined);
assert.equal(dirty.token, undefined);
assert.doesNotMatch(JSON.stringify(dirty), /ya29/);
assert.doesNotMatch(JSON.stringify(dirty), /apps\.googleusercontent/);
cloudSandbox.assertCloudSettingsSafe(dirty);
assert.throws(
  () => cloudSandbox.assertCloudSettingsSafe({ theme: "ocean", accessToken: "ya29.secretvaluehere" }),
  /credential/
);

assert.doesNotMatch(dashboardJs, /collectCloudSettings[\s\S]{0,400}googleClientId/);
assert.match(background, /OAuth client IDs — is dropped/);

console.log("v1.15 settings + google client-id + updates regression ok");
