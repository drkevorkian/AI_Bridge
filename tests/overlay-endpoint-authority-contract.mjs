import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const dynamic = fs.readFileSync(path.join(root, "coordinator-dynamic-agents.js"), "utf8");
const health = fs.readFileSync(path.join(root, "provider-health-runtime.js"), "utf8");
const viewpoint = fs.readFileSync(path.join(root, "viewpoint-runtime.js"), "utf8");

// The core dispatcher allows provider-page content scripts to reach exactly two
// narrowly-scoped endpoints. Every other core command must fail before dispatch
// unless Chrome identifies the sender as an extension page.
assert.match(
  background,
  /CONTENT_SCRIPT_MESSAGE_TYPES\s*=\s*new Set\(\["AI_BRIDGE_FETCH_ARTIFACT",\s*"AI_BRIDGE_RESPONSE"\]\)/,
  "core content-script allowlist must remain limited to response and artifact fallback"
);
assert.match(
  background,
  /if\s*\(!isExtensionPageSender\(sender\)\s*&&\s*!CONTENT_SCRIPT_MESSAGE_TYPES\.has\(msg\.type\)\)\s*\{[\s\S]*?only available from the dashboard or popup/,
  "core dispatcher must reject non-extension callers before ordinary command handling"
);

// Overlay listeners are independent chrome.runtime.onMessage subscribers. They
// therefore need their own caller checks; the core dispatcher's allowlist cannot
// be relied upon to protect them.
assert.match(
  dynamic,
  /msg\.type\s*!==\s*"AI_BRIDGE_SET_AGENT_COUNT"[\s\S]*?requireExtensionPage\(sender,\s*"Set agent count"\)/,
  "dynamic agent-count mutation must require an extension-page sender"
);
assert.match(
  health,
  /function\s+requireHealthCaller\(sender\)[\s\S]*?requireExtensionPage\(sender,\s*"Read provider health"\)/,
  "Provider Health and Adaptive Selector overlay must enforce extension-page authority"
);
assert.match(
  health,
  /msg\.type\s*!==\s*"AI_BRIDGE_PROVIDER_HEALTH"\s*&&\s*msg\.type\s*!==\s*"AI_BRIDGE_ADAPTIVE_SELECT"[\s\S]*?requireHealthCaller\(sender\)/,
  "Provider Health overlay listener must invoke its caller gate before probing"
);
assert.match(
  viewpoint,
  /function\s+requireQueueStatusCaller\(sender\)[\s\S]*?requireExtensionPage\(sender,\s*"Viewpoint queue status"\)/,
  "viewpoint queue telemetry must enforce extension-page authority"
);
assert.match(
  viewpoint,
  /message\?\.type\s*!==\s*"AI_BRIDGE_VIEWPOINT_QUEUE_STATUS"[\s\S]*?requireQueueStatusCaller\(sender\)/,
  "viewpoint queue overlay listener must invoke its caller gate before returning telemetry"
);

console.log("overlay-endpoint-authority-contract: ok");
