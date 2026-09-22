import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");

const manifest = JSON.parse(read("manifest.json"));
const background = read("background.js");
const content = read("content.js");
const html = read("dashboard.html");
const layoutCss = read("dashboard-layouts.css");
const layoutJs = read("dashboard-layouts.js");
const settingsHtml = read("settings.html");

assert.equal(manifest.version, "1.18.1");
assert.match(background, /const STATE_VERSION = 3;/);
assert.match(background, /const CONTENT_VERSION = "1\.18\.1";/);
assert.match(content, /version:\s*"1\.18\.1"/);
assert.doesNotMatch(background, /runtime-core\.js|DISPATCH_STATUS|authorityRegistrationId/,
  "v1.18.1 must stay on the state-v3 relay architecture");

assert.match(html, /id="studioRightPanel" class="studio-right-panel"/);
assert.match(layoutCss, /html\[data-layout="studio"\] \.app-shell\{[\s\S]*?grid-template-columns:[\s\S]*?--bridge-studio-right-width/s);
assert.match(layoutCss, /html\[data-layout="studio"\] \.studio-right-panel/);
assert.match(layoutJs, /function moveToStudioRight\(\)/);
assert.match(layoutJs, /function restoreMovables\(\)/);
assert.doesNotMatch(layoutJs, /AI_BRIDGE_START|AI_BRIDGE_RESUME|bridgeState/,
  "layout-only code must not control relay state");
assert.match(settingsHtml, /<option value="studio">Studio — 3 columns<\/option>/);

assert.match(content, /const RUNTIME_KEY = "__AI_BRIDGE_CONTENT_RUNTIME_V118__";/);
assert.match(content, /residentRuntime\.dispose\("reinjected"\)/);
assert.match(content, /disposeContentRuntime\("extension-context-invalidated"\)/);
assert.match(content, /pendingResponseDelivery = Object\.freeze\(/);
assert.match(content, /await runtimeSendMessage\(pending\.envelope\);[\s\S]*?lastReportedText = pending\.text;[\s\S]*?lastReportedSignature = pending\.signature;/s,
  "response must not be marked reported before background delivery resolves");
assert.match(content, /if \(pendingResponseDelivery\) \{[\s\S]*?await deliverPendingResponse\(\);/s,
  "pending response delivery must retry on later monitor passes");
assert.match(content, /awaitingResponseBaselineNode = baselineNode;/);
assert.match(content, /node === awaitingResponseBaselineNode[\s\S]*?text === awaitingResponseBaselineText/s);
assert.doesNotMatch(content, /new KeyboardEvent\("(?:keydown|keyup)"/,
  "synthetic Enter events are not accepted as proof of Send");
assert.match(content, /form\.requestSubmit\(\)/);
assert.match(content, /Could not prove an actionable Send control/);
assert.match(content, /function firstActionableSendControl\(selectors\)/);
assert.match(content, /let monitorInFlight = false;/);
assert.match(content, /async function runMonitor\(\)/);
assert.match(content, /if \(disposed \|\| monitorInFlight\) return;/);

assert.match(background, /if \(state\.lastResponseBySide\[side\] === text\) return \{ ok: false, duplicate: true \};/,
  "background duplicate guard is required so response retries stay exactly-once at transcript level");

console.log("AI Bridge 1.18.1 three-column relay hardening: OK");
