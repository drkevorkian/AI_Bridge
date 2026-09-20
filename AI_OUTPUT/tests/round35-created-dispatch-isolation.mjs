import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const harness=fs.readFileSync(path.resolve(here,'chrome-e2e-runtime.cjs'),'utf8');

for(const call of [
  'assertPausedDashboard(cdp, dashboardClaimed',
  'assertPausedDashboard(cdp, dashboardAmbiguous'
]) assert.ok(harness.includes(call),'stale paused-dashboard helper signature: '+call);

assert.ok(harness.includes('async function assertRunningAwaitingDashboard'));
assert.ok(harness.includes('assertRunningAwaitingDashboard(cdp, dashboardPositive'));
assert.ok(harness.includes('assertRunningAwaitingDashboard(cdp, dashboardCreated'));

assert.ok(harness.includes("dispatchId: 'e2e-created-never-delivered-d1'"));
assert.ok(harness.includes('createdTarget.dispatchId,\n      positiveStorage.target.dispatchId'));
assert.ok(harness.includes('priorDispatchIds.has(createdTarget.dispatchId)'));
assert.ok(harness.includes('CREATED recovery dispatch ID must not overlap any earlier scenario dispatch'));

console.log('round35-created-dispatch-isolation: PASS');
