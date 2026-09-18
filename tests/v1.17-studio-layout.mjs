import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "dashboard.html"), "utf8");
const css = fs.readFileSync(path.join(root, "dashboard.css"), "utf8");
const dashboardJs = fs.readFileSync(path.join(root, "dashboard.js"), "utf8");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const capsSrc = fs.readFileSync(path.join(root, "agent-capabilities.js"), "utf8");
const cloudV2Src = fs.readFileSync(path.join(root, "cloud-settings-v2.js"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

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

const requiredIds = [
  "start", "pause", "resume", "stop",
  "tabA", "tabB", "tabC", "jobA", "jobB", "jobC",
  "prompt", "teamRules", "interjectText", "sendInterject",
  "themeSelect", "layoutSelect", "layoutStudioBtn", "layoutClassicBtn",
  "toolsToggle",
  "sessionView", "settingsView", "transcript", "controlPanel",
  "workMode", "startSide", "maxCycles", "humanModal"
];
for (const id of requiredIds) {
  assert.match(html, new RegExp(`id="${id}"`), `missing required control id ${id}`);
}

const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
assert.equal(ids.length, new Set(ids).size, `duplicate ids: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);

assert.match(html, /data-layout="studio"/);
assert.match(html, /id="layoutSelect"/);
assert.match(html, /option value="classic"/);
assert.match(html, /studio-slot-topbar/);
assert.match(html, /studio-slot-team/);
assert.match(html, /studio-slot-tools/);
assert.match(html, /studio-slot-composer/);
assert.doesNotMatch(html, /empty-icon">↔/);
assert.match(html, /<svg viewBox="0 0 24 24"/);

assert.match(css, /\[data-layout="studio"\] \.app-shell/);
assert.match(css, /grid-template-areas:/);
assert.match(css, /\.studio-slot-topbar,\s*\n\.studio-slot-team/);
assert.match(css, /display: contents/);
assert.match(css, /\[data-layout="studio"\] \.pane-splitter/);

assert.match(dashboardJs, /const LAYOUT_KEY = "aiBridgeLayout"/);
assert.match(dashboardJs, /const DEFAULT_LAYOUT = "studio"/);
assert.match(dashboardJs, /function applyLayout\(/);
assert.match(dashboardJs, /function loadLayout\(/);
assert.match(dashboardJs, /loadTheme\(\), loadLayout\(\)/);
assert.match(dashboardJs, /shell.classList.toggle\("is-settings"/);
assert.doesNotMatch(dashboardJs, /innerHTML/);
assert.doesNotMatch(dashboardJs, /eval\s*\(|new Function/);

assert.match(background, /const LAYOUT_STORAGE_KEY = "aiBridgeLayout"/);
assert.match(background, /ALLOWED_CLOUD_LAYOUTS/);
assert.match(background, /layout: ALLOWED_CLOUD_LAYOUTS.has\(src.layout\) \? src.layout : "studio"/);
assert.match(background, /\[LAYOUT_STORAGE_KEY\]: winner.settings.layout/);

assert.match(readme, /is the default for new installs/i);
assert.match(readme, /dashboard layout \(Studio \/ Classic\)/i);

const sandbox = {
  SIDES: ["A", "B", "C"],
  INFINITE_TURNS: -1,
  CLOUD_SETTINGS_VERSION: 2,
  ALLOWED_CLOUD_THEMES: new Set(["blizzard", "ghostwhite", "midnight", "slate", "light", "solarized", "ocean", "terminal"]),
  ALLOWED_CLOUD_LAYOUTS: new Set(["studio", "classic"]),
  Date,
  Number,
  String,
  Boolean,
  Array,
  Object,
  Set,
  Math
};
sandbox.normalizeWorkMode = function normalizeWorkMode(raw) {
  const allowed = new Set(["relay", "collaborate", "compete", "parallel", "review", "mesh"]);
  return allowed.has(raw) ? raw : "relay";
};
sandbox.normalizeMaxTurns = function normalizeMaxTurns(raw) {
  const n = Number(raw);
  if (n === -1) return -1;
  if (!Number.isInteger(n) || n < 1 || n > 10000) throw new Error("bad turns");
  return n;
};
sandbox.clampCheckpointEvery = function clampCheckpointEvery(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n)) return 5;
  return Math.min(50, Math.max(1, n));
};
sandbox.clampStuckTimeoutMinutes = function clampStuckTimeoutMinutes(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n)) return 30;
  return Math.min(120, Math.max(5, n));
};
sandbox.clampCloudPane = function clampCloudPane(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 40;
  return Math.min(70, Math.max(24, Math.round(n * 10) / 10));
};

const context = vm.createContext(sandbox);
context.globalThis = context;
vm.runInContext(capsSrc, context, { filename: "agent-capabilities.js" });
vm.runInContext(cloudV2Src, context, { filename: "cloud-settings-v2.js" });
vm.runInContext(
  [
    extractFunction(background, "cloudSettingsV2Contract"),
    extractFunction(background, "sanitizeHistoryForCloud"),
    extractFunction(background, "sanitizeCloudSettings"),
    "this.sanitizeCloudSettings = sanitizeCloudSettings;"
  ].join("\n"),
  context
);

const clean = sandbox.sanitizeCloudSettings({
  theme: "midnight",
  layout: "classic",
  paneWidth: 33,
  workMode: "mesh",
  startSide: "B",
  token: "ya29.should-drop",
  transcript: [{ text: "nope" }]
}, { stamp: false });

assert.equal(clean.layout, "classic");
assert.equal(clean.theme, "midnight");
assert.equal(clean.token, undefined);
assert.equal(clean.transcript, undefined);

const fallback = sandbox.sanitizeCloudSettings({ layout: "neon-cyber" }, { stamp: false });
assert.equal(fallback.layout, "studio", "unknown layout must fail closed to studio");

const dropped = sandbox.sanitizeCloudSettings({ layout: "<script>" }, { stamp: false });
assert.equal(dropped.layout, "studio");

console.log("v1.17 studio layout checks passed.");
