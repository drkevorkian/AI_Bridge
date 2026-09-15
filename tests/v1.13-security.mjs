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
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

assert.equal(manifest.version, "1.13.0");
assert.ok(manifest.permissions.includes("identity"));
assert.ok(manifest.permissions.includes("storage"));
assert.equal(manifest.oauth2, undefined, "do not ship a placeholder OAuth client ID");
assert.ok(manifest.host_permissions.every(rule => rule.startsWith("https://")));
assert.match(html, /v1\.13\.0/);
assert.match(popupHtml, /v1\.13\.0/);
assert.match(html, /id="cloudPush"/);
assert.match(html, /id="cloudPull"/);
assert.match(html, /id="cloudConnect"/);
assert.match(html, /id="cloudStatusPill"/);
assert.match(html, /id="workModeHelp"/);
assert.match(css, /white-space:\s*pre-wrap/);
assert.match(dashboardJs, /AI_BRIDGE_CLOUD_PUSH/);
assert.match(dashboardJs, /Timing: sequential A → B → C/);
assert.match(dashboardJs, /replaceChildren/);
assert.doesNotMatch(dashboardJs, /innerHTML/);
assert.match(content, /version: "1\.11\.3"/);
assert.match(background, /CONTENT_VERSION = "1\.11\.3"/);

const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
assert.equal(ids.length, new Set(ids).size, `duplicate ids: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);

function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} missing`);
  let depth = 0;
  let i = src.indexOf("{", start);
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
assert.match(background, /Tokens stay in Chrome's identity cache only/);
assert.doesNotMatch(background, /url\.protocol !== "https:" && url\.protocol !== "http:"/);

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
  SIDES: ["A", "B", "C"],
  INFINITE_TURNS: -1,
  WORK_MODES: new Set(["relay", "collaborate", "compete", "parallel", "review", "mesh"]),
  ALLOWED_CLOUD_THEMES: new Set(["blizzard", "ghostwhite", "midnight", "slate", "light", "solarized", "ocean", "terminal"]),
  CLOUD_SETTINGS_VERSION: 1,
  SYNC_ITEM_MAX_CHARS: 7000
};
vm.runInNewContext(
  [
    "function normalizeWorkMode(raw) { const value = String(raw || 'relay').toLowerCase(); return WORK_MODES.has(value) ? value : 'relay'; }",
    "function normalizeMaxTurns(raw) { const value = Number(raw); if (value === -1) return -1; if (!Number.isInteger(value) || value < 1 || value > 10000) throw new Error('bad turns'); return value; }",
    extractFunction(background, "clampCloudPane"),
    extractFunction(background, "sanitizeHistoryForCloud"),
    extractFunction(background, "sanitizeCloudSettings"),
    extractFunction(background, "splitCloudSyncChunks"),
    "this.clampCloudPane = clampCloudPane;",
    "this.sanitizeCloudSettings = sanitizeCloudSettings;",
    "this.splitCloudSyncChunks = splitCloudSyncChunks;"
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
  activeArtifactIds: ["vault-1"],
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
assert.equal(dirty.activeArtifactIds, undefined);
assert.equal(dirty.history.jobs.length, 1);
assert.equal(cloudSandbox.sanitizeCloudSettings({ theme: "not-a-theme", workMode: "explode" }).theme, "blizzard");
assert.equal(cloudSandbox.sanitizeCloudSettings({ workMode: "explode" }).workMode, "relay");

const chunks = cloudSandbox.splitCloudSyncChunks("x".repeat(8000));
assert.equal(chunks.length, 2);
assert.ok(chunks[0].length <= 7000);
assert.equal(chunks[0].length + chunks[1].length, 8000);

const modes = ["relay", "collaborate", "compete", "parallel", "review", "mesh"];
for (const mode of modes) {
  assert.match(dashboardJs, new RegExp(`${mode}:\\s*\\{`));
}
assert.match(dashboardJs, /Peer visibility/);
assert.match(dashboardJs, /Cycle:/);
assert.match(dashboardJs, /Main AI:/);
assert.match(dashboardJs, /Best for:/);

console.log("v1.13 security + cloud regression ok");
