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
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

assert.equal(manifest.version, "1.14.0");
assert.ok(manifest.permissions.includes("identity"));
assert.ok(manifest.permissions.includes("storage"));
assert.ok(manifest.permissions.includes("alarms"));
assert.equal(manifest.oauth2, undefined, "do not ship a placeholder OAuth client ID");
assert.ok(manifest.host_permissions.every(rule => rule.startsWith("https://")));
assert.ok(manifest.host_permissions.includes("https://www.googleapis.com/*"));
assert.ok(!manifest.host_permissions.some(rule => rule.startsWith("http://")));
assert.match(html, /v1\.14\.0/);
assert.match(popupHtml, /v1\.14\.0/);
assert.match(html, /id="cloudPush"/);
assert.match(html, /id="cloudPull"/);
assert.match(html, /id="cloudConnect"/);
assert.match(html, /id="cloudUnlink"/);
assert.match(html, /id="cloudStatusPill"/);
assert.match(html, /id="workModeHelp"/);
assert.match(css, /white-space:\s*pre-wrap/);
assert.match(dashboardJs, /AI_BRIDGE_CLOUD_PUSH/);
assert.match(dashboardJs, /AI_BRIDGE_CLOUD_UNLINK/);
assert.match(dashboardJs, /Timing: sequential A → B → C/);
assert.match(dashboardJs, /replaceChildren/);
assert.doesNotMatch(dashboardJs, /innerHTML/);
assert.match(content, /version: "1\.14\.0"/);
assert.match(background, /CONTENT_VERSION = "1\.14\.0"/);
assert.doesNotMatch(readme, /not yet on main/i);
assert.match(readme, /Current version: 1\.14\.0/);

const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
assert.equal(ids.length, new Set(ids).size, `duplicate ids: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);

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

const allowSandbox = { URL };
vm.runInNewContext(`${extractFunction(background, "artifactFetchHostAllowed")}\nthis.artifactFetchHostAllowed = artifactFetchHostAllowed;`, allowSandbox);
const allowed = allowSandbox.artifactFetchHostAllowed;

assert.equal(allowed("https://chatgpt.com/file.bin"), true);
assert.equal(allowed("https://assets.grok.com/a.bin"), true);
assert.equal(allowed("https://user-content.oaiusercontent.com/x"), true);
assert.equal(allowed("http://chatgpt.com/file.bin"), false, "HTTP must fail closed");
assert.equal(allowed("https://evil.example/file.bin"), false);
assert.equal(allowed("https://user:pass@chatgpt.com/file.bin"), false, "embedded credentials rejected");
assert.equal(allowed("javascript:alert(1)"), false);
assert.equal(allowed("data:text/plain,hi"), false);
assert.equal(allowed("ftp://chatgpt.com/file.bin"), false);
assert.equal(allowed("https://chatgpt.com.evil.com/x"), false);
assert.equal(allowed(""), false);

assert.match(background, /redirected off the HTTPS allowlist/);
assert.match(background, /TRUSTED_CONTEXTS/);
assert.match(background, /CONTENT_SCRIPT_MESSAGE_TYPES/);
assert.match(background, /requireBoundSessionTab\(sender, "Artifact fetch"\)/);
assert.match(background, /boundSideFromSender\(sender\)/);
assert.match(background, /This AI Bridge command is only available from the dashboard or popup/);
assert.match(background, /SYNC_ITEM_MAX_CHARS = 7000/);
assert.doesNotMatch(background, /url\.protocol !== "https:" && url\.protocol !== "http:"/);

assert.match(background, /DRIVE_APP_DATA_SCOPE = "https:\/\/www\.googleapis\.com\/auth\/drive\.appdata"/);
assert.doesNotMatch(background, /googleapis\.com\/auth\/drive"/);
assert.doesNotMatch(background, /auth\/drive\.file/);
assert.match(background, /spaces=appDataFolder/);
assert.match(background, /parents:\s*\["appDataFolder"\]/);
assert.match(background, /ai-bridge-settings\.json/);
assert.match(background, /redirect:\s*"error"/);
assert.match(background, /attempt >= 1/);
assert.match(background, /removeCachedAuthToken/);
assert.match(background, /clearAllCachedAuthTokens/);
assert.match(background, /parseDriveSettingsBody/);
assert.match(background, /requireExtensionPage\(sender, "Link Google account"\)/);
assert.match(background, /requireExtensionPage\(sender, "Unlink Google account"\)/);
assert.match(background, /Stop the active Bridge session before pulling cloud settings/);
assert.match(background, /interactive: Boolean\(interactive\)/);
assert.equal(JSON.stringify(manifest).includes("YOUR_"), false);
assert.equal(JSON.stringify(manifest).includes("PLACEHOLDER"), false);

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
  SYNC_ITEM_MAX_CHARS: 7000,
  CLOUD_SYNC_MAX_BYTES: 90000,
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
    extractFunction(background, "parseDriveSettingsBody"),
    extractFunction(background, "pickNewestCloudCopy"),
    extractFunction(background, "splitCloudSyncChunks"),
    extractFunction(background, "driveUrlAllowed"),
    "this.clampCloudPane = clampCloudPane;",
    "this.sanitizeCloudSettings = sanitizeCloudSettings;",
    "this.assertCloudSettingsSafe = assertCloudSettingsSafe;",
    "this.parseDriveSettingsBody = parseDriveSettingsBody;",
    "this.pickNewestCloudCopy = pickNewestCloudCopy;",
    "this.splitCloudSyncChunks = splitCloudSyncChunks;",
    "this.driveUrlAllowed = driveUrlAllowed;"
  ].join("\n"),
  cloudSandbox
);

const dirty = cloudSandbox.sanitizeCloudSettings({
  theme: "midnight",
  paneWidth: 33,
  workMode: "mesh",
  startSide: "B",
  maxTurns: 12,
  delayMs: 2000,
  freshOnStart: true,
  jobA: "Lead",
  teamRules: "SECURITY FIRST",
  tabA: 99,
  transcript: [{ text: "secret conversation" }],
  sourceFiles: [{ path: "secret.js", content: "code" }],
  oauthToken: "ya29.secret",
  accessToken: "ya29.secret",
  token: "ya29.secret",
  activeArtifactIds: ["vault-1"],
  recoveryCheckpoint: { text: "secret restart summary", cycleCount: 4 },
  cycleCount: 4,
  generationIdBySide: { A: "A-1" },
  history: { jobs: [{ time: 1, side: "A", label: "A", job: "Lead" }], commands: [{ text: "obj" }], rules: [{ text: "SECURITY FIRST" }] }
});
assert.equal(dirty.theme, "midnight");
assert.equal(dirty.paneWidth, 33);
assert.equal(dirty.workMode, "mesh");
assert.equal(dirty.startSide, "B");
assert.equal(dirty.jobA, "Lead");
assert.equal(dirty.teamRules, "SECURITY FIRST");
assert.equal(dirty.tabA, undefined);
assert.equal(dirty.transcript, undefined);
assert.equal(dirty.sourceFiles, undefined);
assert.equal(dirty.oauthToken, undefined);
assert.equal(dirty.accessToken, undefined);
assert.equal(dirty.token, undefined);
assert.equal(dirty.activeArtifactIds, undefined);
assert.equal(dirty.recoveryCheckpoint, undefined);
assert.equal(dirty.cycleCount, undefined);
assert.equal(dirty.generationIdBySide, undefined);
assert.equal(dirty.history.jobs.length, 1);
assert.doesNotMatch(JSON.stringify(dirty), /ya29/);
cloudSandbox.assertCloudSettingsSafe(dirty);
assert.equal(cloudSandbox.sanitizeCloudSettings({ theme: "not-a-theme", workMode: "explode" }).theme, "blizzard");
assert.equal(cloudSandbox.sanitizeCloudSettings({ workMode: "explode" }).workMode, "relay");

const preserved = cloudSandbox.sanitizeCloudSettings({ theme: "ocean", updatedAt: 111 }, { stamp: false });
assert.equal(preserved.updatedAt, 111);

const chunks = cloudSandbox.splitCloudSyncChunks("x".repeat(8000));
assert.equal(chunks.length, 2);
assert.ok(chunks[0].length <= 7000);
assert.equal(chunks[0].length + chunks[1].length, 8000);

const driveOk = cloudSandbox.driveUrlAllowed;
assert.equal(driveOk("https://www.googleapis.com/drive/v3/files?spaces=appDataFolder"), true);
assert.equal(driveOk("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart"), true);
assert.equal(driveOk("https://www.googleapis.com/drive/v3/files/abcDEF123_-?alt=media"), true);
assert.equal(driveOk("http://www.googleapis.com/drive/v3/files"), false, "Drive host permission is HTTPS-only");
assert.equal(driveOk("https://content.googleapis.com/drive/v3/files"), false);
assert.equal(driveOk("https://evil.googleapis.com/drive/v3/files"), false);
assert.equal(driveOk("https://www.googleapis.com.evil.com/drive/v3/files"), false);
assert.equal(driveOk("https://www.googleapis.com/drive/v2/files"), false);
assert.equal(driveOk("https://www.googleapis.com/drive/v3/files/../secrets"), false);
assert.equal(driveOk("https://accounts.google.com/o/oauth2/v2/auth"), false);

assert.throws(() => cloudSandbox.parseDriveSettingsBody(""), /empty/);
assert.throws(() => cloudSandbox.parseDriveSettingsBody("{not json"), /not valid JSON/);
assert.throws(() => cloudSandbox.parseDriveSettingsBody("[]"), /malformed/);
assert.throws(() => cloudSandbox.parseDriveSettingsBody("null"), /malformed/);
assert.throws(() => cloudSandbox.parseDriveSettingsBody("x".repeat(90001)), /too large/);
const fromDrive = cloudSandbox.parseDriveSettingsBody(JSON.stringify({
  theme: "terminal",
  updatedAt: 222,
  tabA: 7,
  oauthToken: "ya29.should-never-land",
  transcript: ["nope"]
}));
assert.equal(fromDrive.theme, "terminal");
assert.equal(fromDrive.updatedAt, 222);
assert.equal(fromDrive.tabA, undefined);
assert.equal(fromDrive.oauthToken, undefined);
assert.equal(fromDrive.transcript, undefined);

const newest = cloudSandbox.pickNewestCloudCopy([
  { via: "chrome-sync", settings: { updatedAt: 10 } },
  { via: "google-drive", settings: { updatedAt: 20 } }
]);
assert.equal(newest.via, "google-drive");
assert.equal(cloudSandbox.pickNewestCloudCopy([]), null);

const modes = ["relay", "collaborate", "compete", "parallel", "review", "mesh"];
for (const mode of modes) {
  assert.match(dashboardJs, new RegExp(`${mode}:\\s*\\{`));
}
assert.match(dashboardJs, /Peer visibility/);
assert.match(dashboardJs, /Cycle:/);
assert.match(dashboardJs, /Main AI:/);
assert.match(dashboardJs, /Best for:/);

console.log("v1.13 security + cloud regression ok");
