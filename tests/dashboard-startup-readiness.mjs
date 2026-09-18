import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const dashboard = fs.readFileSync(path.join(root, "dashboard.js"), "utf8");

assert.match(background, /STARTUP_BINDING_TIMEOUT_MS = 3000/);
assert.match(background, /STARTUP_AUX_TIMEOUT_MS = 4000/);
assert.match(background, /function startupTimeout\(/);
assert.match(background, /Promise\.all\(SIDES\.map\(async side =>/);
assert.match(background, /startupTimeout\(tabExists\(tabId\)/);
assert.match(background, /finishLoadedStateStartup\(loadFailure\)/);
assert.match(background, /queueMicrotask\(\(\) => \{/);
assert.match(background, /Everything below is auxiliary startup work and must never/);
assert.match(background, /stateReady = loadState\(\)/);

assert.match(dashboard, /DASHBOARD_MESSAGE_TIMEOUT_MS = 5000/);
assert.match(dashboard, /function dashboardTimeout\(/);
assert.match(dashboard, /dashboardTimeout\(chrome\.runtime\.sendMessage\(\{/);
assert.match(dashboard, /const initialDashboardLoads = Promise\.all\(/);
assert.match(dashboard, /Dashboard initialization warning:/);

assert.doesNotMatch(
  background,
  /await Promise\.all\(SIDES\.map\(side => ensureTabListener\(tabForSide\(side\)\)\)\);/,
  "provider-listener reconnect must not block stateReady"
);

console.log("dashboard-startup-readiness: bounded startup + message handshake ok");
