import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const dynamic = fs.readFileSync(path.join(root, "dashboard-dynamic-agents.js"), "utf8");

assert.match(background, /EARLY_STARTUP_TIMEOUT_MS = 5000/);
assert.match(background, /function earlyStartupTimeout\(/);
assert.match(background, /Lock chrome\.storage\.local access/);
assert.match(background, /Lock chrome\.storage\.sync access/);
assert.match(background, /Read AI Bridge local storage/);
assert.match(background, /AI Bridge state readiness", 6000/);
assert.match(background, /initialStorageFailure/);

assert.match(dynamic, /DYNAMIC_BOOT_TIMEOUT_MS = 5000/);
assert.match(dynamic, /function dynamicTimeout\(/);
assert.match(dynamic, /Dynamic dashboard state request/);
assert.match(dynamic, /Provider health request/);
assert.match(dynamic, /Dynamic dashboard tab refresh/);
assert.match(dynamic, /function reportDynamicStartupFailure\(/);
assert.match(dynamic, /Provider health unavailable/);
assert.match(dynamic, /Dashboard startup warning/);
assert.match(dynamic, /bootstrap\(\)\.catch\(reportDynamicStartupFailure\)/);

assert.doesNotMatch(
  dynamic,
  /const stateResponse = await chrome\.runtime\.sendMessage/,
  "dynamic roster state bootstrap must be timeout-bounded"
);
assert.doesNotMatch(
  dynamic,
  /const adaptive = await chrome\.runtime\.sendMessage/,
  "provider-health bootstrap must be timeout-bounded"
);

console.log("dashboard-startup-watchdog-v2: all startup choke points are bounded");
