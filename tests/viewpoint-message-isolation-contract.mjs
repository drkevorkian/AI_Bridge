import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

// Provider pages are deliberately limited to two worker endpoints. Ordinary
// extension-control messages must remain extension-page-only.
assert.match(
  background,
  /CONTENT_SCRIPT_MESSAGE_TYPES\s*=\s*new Set\(\["AI_BRIDGE_FETCH_ARTIFACT",\s*"AI_BRIDGE_RESPONSE"\]\)/,
  "content scripts must remain restricted to response and artifact-fallback endpoints"
);

// Sender-tab authority is safe because the provider content script is installed
// only in the top frame. If subframe injection is ever enabled, the response and
// artifact boundaries must be re-audited to include sender.frameId before that
// manifest change can ship.
assert.ok(Array.isArray(manifest.content_scripts) && manifest.content_scripts.length > 0,
  "manifest must define provider content scripts");
for (const registration of manifest.content_scripts) {
  assert.notEqual(registration?.all_frames, true,
    "provider content scripts must remain top-frame-only unless sender.frameId is added to the authority contract");
}

// Response authority comes from Chrome's authenticated sender tab. Never trust
// a caller-supplied logical side from provider-page JavaScript.
assert.match(
  background,
  /function\s+boundSideFromSender\(sender\)[\s\S]*?sender\?\.tab\?\.id[\s\S]*?sideForTab\(tabId\)/,
  "worker must derive logical side from sender.tab.id"
);
assert.match(
  background,
  /msg\.type\s*===\s*"AI_BRIDGE_RESPONSE"[\s\S]*?const\s+side\s*=\s*boundSideFromSender\(sender\)/,
  "AI_BRIDGE_RESPONSE must derive side from the sender tab"
);
assert.match(
  background,
  /generationMatches\(state\.generationIdBySide\?\.\[side\],\s*incomingGenerationId\)/,
  "response generation token must be checked against the sender-derived side"
);

// Artifact fallback has the same sender-bound authority boundary before any URL
// validation/fetch work occurs.
assert.match(
  background,
  /msg\.type\s*===\s*"AI_BRIDGE_FETCH_ARTIFACT"[\s\S]*?requireBoundSessionTab\(sender,\s*"Artifact fetch"\)/,
  "artifact fallback must require a currently bound session tab"
);

// The provider content script should not even transmit a logical side in its
// response payload. This keeps identity authority entirely in the worker.
const responseTypeIndex = content.indexOf('type: "AI_BRIDGE_RESPONSE"');
assert.ok(responseTypeIndex >= 0, "content script must send AI_BRIDGE_RESPONSE");
const responseCallStart = content.lastIndexOf("chrome.runtime.sendMessage({", responseTypeIndex);
const responseCallEnd = content.indexOf("});", responseTypeIndex);
assert.ok(responseCallStart >= 0 && responseCallEnd > responseTypeIndex,
  "AI_BRIDGE_RESPONSE sendMessage payload must be statically discoverable");
const responsePayload = content.slice(responseCallStart, responseCallEnd + 3);
assert.doesNotMatch(
  responsePayload,
  /(?:^|[,\n\r])\s*side\s*:/m,
  "provider content script must never nominate its own logical side"
);
assert.match(responsePayload, /generationId:\s*currentGenerationId/,
  "provider response must carry only its armed generation identity for worker validation");

console.log("viewpoint-message-isolation-contract: ok");