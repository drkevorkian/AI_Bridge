import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const dashboard=fs.readFileSync(path.join(root,"dashboard.js"),"utf8");

assert.match(dashboard,/const DASHBOARD_MESSAGE_TIMEOUT_MS = 5000;/);
assert.match(dashboard,/const START_REQUEST_TIMEOUT_MS = 75000;/);
assert.match(dashboard,/function dashboardTimeout\(/);
assert.match(dashboard,/Bridge startup", START_REQUEST_TIMEOUT_MS/);
assert.match(dashboard,/Startup response timed out — checking saved Bridge state/);
assert.match(dashboard,/Bridge is RUNNING\. State was recovered/);
assert.match(dashboard,/Startup reached a PAUSED state/);
assert.match(dashboard,/Startup reached a DEGRADED saved state/);
assert.match(dashboard,/Startup FAILED — no active session was committed/);
assert.match(dashboard,/Startup FAILED — Bridge state could not be confirmed/);

console.log("AI Bridge bounded startup guard: OK");
