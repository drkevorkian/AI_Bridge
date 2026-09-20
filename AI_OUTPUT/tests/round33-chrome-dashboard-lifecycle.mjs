import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const harness=fs.readFileSync(path.resolve(here,'chrome-e2e-runtime.cjs'),'utf8');

assert.ok(harness.includes('let currentDashboard = dashboardCreated'));
assert.ok(harness.includes('targetId: currentDashboard.targetId'));
assert.ok(harness.includes('currentDashboard = dashboardAmbiguous'));
assert.ok(!harness.includes("if (seededStatus === 'DISPATCHING')"));

assert.ok(harness.includes("createdRecovered.stored.bridgeState?.runtimePhase, 'AWAITING_PROVIDER_RESPONSE'"));
assert.ok(harness.includes('const createdUi = await assertRunningAwaitingDashboard(cdp, dashboardCreated)'));
assert.ok(harness.includes('assert.match(createdUi.status, /Runtime:\\s*Awaiting provider response/i)'));
assert.ok(harness.includes('assert.doesNotMatch(String(state.status || \'\'), /Runtime:\\s*Paused/i)'));

const dispatchingIndex=harness.indexOf("for (const seededStatus of ['DISPATCHING', 'ACCEPTED'])");
const currentCloseIndex=harness.indexOf('targetId: currentDashboard.targetId',dispatchingIndex);
const currentReassignIndex=harness.indexOf('currentDashboard = dashboardAmbiguous',currentCloseIndex);
assert.ok(dispatchingIndex>=0 && currentCloseIndex>dispatchingIndex && currentReassignIndex>currentCloseIndex);

console.log('round33-chrome-dashboard-lifecycle: PASS');
