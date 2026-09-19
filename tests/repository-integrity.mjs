import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");
const exists = rel => fs.existsSync(path.join(root, rel));

const expectedFiles = [
  "README.md",
  "background.js",
  "content.js",
  "dashboard.css",
  "dashboard.html",
  "dashboard.js",
  "dashboard-layouts.css",
  "dashboard-layouts.js",
  "settings.css",
  "settings.html",
  "settings.js",
  "icon128.png",
  "manifest.json",
  "popup.css",
  "popup.html",
  "popup.js",
  ".github/workflows/regression.yml"
];
for (const rel of expectedFiles) assert.ok(exists(rel), `missing repository file: ${rel}`);

const manifest = JSON.parse(read("manifest.json"));
const background = read("background.js");
const content = read("content.js");
const dashboardHtml = read("dashboard.html");
const dashboardJs = read("dashboard.js");
const popupHtml = read("popup.html");
const popupJs = read("popup.js");
const settingsHtml = read("settings.html");
const settingsJs = read("settings.js");
const layoutJs = read("dashboard-layouts.js");
const readme = read("README.md");
const workflow = read(".github/workflows/regression.yml");
const allJs = [background, content, dashboardJs, layoutJs, settingsJs, popupJs].join("\n");

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.name, "AI Bridge");
assert.match(manifest.version, /^\d+(?:\.\d+){1,3}$/);

const bgVersion = background.match(/const CONTENT_VERSION = "([^"]+)"/)?.[1];
const contentVersion = content.match(/version: "([^"]+)"/)?.[1];
assert.equal(bgVersion, manifest.version, "background/runtime version drift");
assert.equal(contentVersion, manifest.version, "content/runtime version drift");
assert.match(readme.split(/\r?\n/, 1)[0], new RegExp(`\\b${manifest.version.replaceAll(".", "\\.")}\\b`), "README release header drift");

assert.equal(manifest.externally_connectable, undefined, "web pages must not be able to message the extension directly");
assert.ok(!(manifest.permissions || []).includes("debugger"), "debugger permission is not allowed");
assert.ok(!(manifest.host_permissions || []).includes("<all_urls>"), "<all_urls> is not allowed");
for (const host of manifest.host_permissions || []) assert.match(host, /^https:\/\//, `non-HTTPS host permission: ${host}`);

const referenced = new Set();
if (manifest.background?.service_worker) referenced.add(manifest.background.service_worker);
if (manifest.action?.default_popup) referenced.add(manifest.action.default_popup);
for (const value of Object.values(manifest.action?.default_icon || {})) referenced.add(value);
for (const script of manifest.content_scripts || []) for (const file of script.js || []) referenced.add(file);
for (const value of Object.values(manifest.icons || {})) referenced.add(value);
for (const html of [dashboardHtml, popupHtml, settingsHtml]) {
  for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) referenced.add(match[1]);
  for (const match of html.matchAll(/<link[^>]+href="([^"]+)"/g)) referenced.add(match[1]);
  assert.doesNotMatch(html, /<script(?![^>]+src=)[^>]*>/i, "inline scripts are not allowed");
}
for (const rel of referenced) assert.ok(exists(rel), `referenced file does not exist: ${rel}`);

function ids(html) {
  return [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
}
function assertUniqueIds(html, name) {
  const values = ids(html);
  assert.equal(values.length, new Set(values).size, `${name} contains duplicate DOM IDs`);
  return new Set(values);
}
function dollarRefs(js) {
  return [...js.matchAll(/\$\("([^"]+)"\)/g)].map(match => match[1]);
}
const dashboardIds = assertUniqueIds(dashboardHtml, "dashboard.html");
const popupIds = assertUniqueIds(popupHtml, "popup.html");
for (const id of dollarRefs(dashboardJs)) assert.ok(dashboardIds.has(id), `dashboard.js references missing DOM id: ${id}`);
for (const id of dollarRefs(popupJs)) assert.ok(popupIds.has(id), `popup.js references missing DOM id: ${id}`);

for (const side of ["A", "B", "C", "D", "E"]) {
  for (const prefix of ["agentCard", "tab", "job", "timer", "newChat", "resend"]) {
    assert.ok(dashboardIds.has(prefix + side), `dynamic roster is missing ${prefix}${side}`);
  }
}
assert.ok(dashboardIds.has("agentCount"), "dashboard is missing the active-agent count control");
assert.match(settingsHtml, /Blizzard Blue/);
assert.match(settingsHtml, /Ghost White/);
assert.match(settingsHtml, /Midnight/);
assert.match(settingsHtml, /Slate/);
assert.match(settingsHtml, /Solarized Light/);
assert.match(settingsHtml, /Ocean/);
assert.match(settingsHtml, /Terminal/);
assert.match(settingsHtml, /value="studio"/);
assert.match(settingsHtml, /value="classic"/);
assert.match(settingsHtml, /value="focus"/);
assert.match(settingsHtml, /id="syncPush"/);
assert.match(settingsHtml, /id="googleLink"/);
assert.match(settingsHtml, /id="refreshHealth"/);
assert.match(settingsHtml, /id="keepAwake"/);
assert.match(settingsHtml, /id="checkUpdates"/);
assert.match(manifest.permissions.join(","), /identity/);
assert.match(manifest.permissions.join(","), /alarms/);
assert.match(manifest.permissions.join(","), /power/);
assert.match(background, /AI_BRIDGE_POWER_SET/);
assert.match(background, /AI_BRIDGE_AUTO_UPDATE_SET/);
assert.doesNotMatch(settingsJs, /bridgeState\s*=\s*.*sessionActive\s*:\s*true/s, "Settings must not synthesize an active relay session");
assert.doesNotMatch(layoutJs, /AI_BRIDGE_START|AI_BRIDGE_RESUME|bridgeState/, "layout module must not control relay state");
assert.match(background, /const ALL_SIDES = \["A", "B", "C", "D", "E"\]/);
assert.match(background, /agentCount: DEFAULT_AGENT_COUNT/);
assert.match(background, /minimumTurnsForWorkMode\(mode = state\.workMode, agentCount = SIDES\.length\)/);
assert.match(background, /new Set\(tabIds\)\.size !== tabIds\.length/);
assert.match(background, /Separate tabs from the same LLM are allowed/);
assert.match(dashboardJs, /const ALL_SIDES = \["A", "B", "C", "D", "E"\]/);
assert.match(dashboardJs, /agentCount: SIDES\.length/);
assert.match(dashboardJs, /Multiple tabs from the same LLM are allowed/);
assert.doesNotMatch(background, /\[abc\]/i, "mesh routing must not remain limited to A-C");
assert.doesNotMatch(dashboardJs, /validateThreeTabs|Starting three-AI|all three AIs/i, "dashboard must not retain fixed three-agent behavior");

for (const removedExperimental of [
  "agent-capabilities.js",
  "provider-health-runtime.js",
  "viewpoint-runtime.js",
  "oauth-runtime-hardening.js",
  "roster-v2-migration.js",
  "cloud-settings-v2.js"
]) {
  assert.ok(!exists(removedExperimental), `out-of-scope experimental file was reintroduced: ${removedExperimental}`);
}

for (const forbidden of [
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /document\.write\s*\(/,
  /\.outerHTML\s*=/,
  /insertAdjacentHTML\s*\(/
]) {
  assert.doesNotMatch(allJs, forbidden, `forbidden dynamic-code/HTML sink: ${forbidden}`);
}

assert.doesNotMatch(background, /\bsetInterval\s*\(/, "service worker must not contain a persistent setInterval loop");
const unconditionalWhile = allJs.match(/\bwhile\s*\(\s*true\s*\)/g) || [];
assert.equal(unconditionalWhile.length, 1, "unexpected unconditional while(true) loop added");
assert.match(background, /while\s*\(\s*true\s*\)\s*\{\s*const\s*\{\s*value,\s*done\s*\}\s*=\s*await\s+reader\.read\(\);\s*if\s*\(done\)\s*break;/s,
  "the only while(true) loop must remain the terminating artifact stream reader");

const handledByBackground = new Set([...background.matchAll(/msg\.type\s*===\s*"([A-Z0-9_]+)"/g)].map(m => m[1]));
const handledByContent = new Set([...content.matchAll(/msg\.type\s*===\s*"([A-Z0-9_]+)"/g)].map(m => m[1]));
const literalTypes = src => [...new Set([...src.matchAll(/type:\s*"([A-Z0-9_]+)"/g)].map(m => m[1]))];
for (const type of literalTypes(dashboardJs + "\n" + popupJs)) {
  assert.ok(handledByBackground.has(type), `extension page sends unhandled background message: ${type}`);
}
for (const type of literalTypes(content)) {
  assert.ok(handledByBackground.has(type), `content script sends unhandled background message: ${type}`);
}
for (const type of ["AI_BRIDGE_PING", "AI_BRIDGE_NEW_CHAT", "AI_BRIDGE_SEND"]) {
  assert.ok(handledByContent.has(type), `background/content protocol handler missing: ${type}`);
}

const workflowTestRefs = [...workflow.matchAll(/\btests\/[A-Za-z0-9._/-]+/g)].map(m => m[0]);
for (const rel of new Set(workflowTestRefs)) assert.ok(exists(rel), `workflow references missing test: ${rel}`);

console.log(`AI Bridge ${manifest.version} repository integrity: OK`);
