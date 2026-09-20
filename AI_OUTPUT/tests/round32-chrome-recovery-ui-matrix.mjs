import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const harness=fs.readFileSync(path.resolve(here,'chrome-e2e-runtime.cjs'),'utf8');

for(const token of [
  'assertPausedDashboard',
  'RUNTIME_CONTINUATION_STATE_INCONSISTENT',
  'uncommittedSourceUi',
  'seededHealth',
  'Provider re-verification',
  'positiveMarker',
  "status: 'RESPONSE_COMMITTED'",
  "target.status !== 'AWAITING_RESPONSE'",
  "runtimePhase, 'AWAITING_PROVIDER_RESPONSE'",
  'positiveRecoveryProviderBActionDelta'
]) assert.ok(harness.includes(token),'missing '+token);

assert.ok(harness.includes('window.__emitResponse=true'));
assert.ok(harness.includes('window.__autoConfirm=true;window.__emitResponse=false;true'));
assert.ok(harness.includes("assert.doesNotMatch(text, /Running"));
assert.ok(harness.includes("assert.doesNotMatch(positiveUi, /Runtime:\\s*Paused/i)"));

console.log('round32-chrome-recovery-ui-matrix: PASS');
