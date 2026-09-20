import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const runtime=path.resolve(here,'..','runtime_review');
const background=fs.readFileSync(path.join(runtime,'background.js'),'utf8');
const dashboard=fs.readFileSync(path.join(runtime,'dashboard.js'),'utf8');

for(const token of [
  'nextTurnPending',
  'NEXT_TURN_PENDING',
  'RECOVERING_NEXT_TURN',
  'reviewBuildNextTurnPending',
  'reviewPersistNextTurnPending',
  'reviewRecoverNextTurnPending',
  'continuationSourceDispatchId'
]) assert.ok(background.includes(token),token+' missing');

const processStart=background.indexOf('async function reviewProcessIncomingEnvelope');
const processEnd=background.indexOf('\nasync function reviewDrainParkedResponses',processStart);
assert.ok(processStart>=0 && processEnd>processStart,'response processor block missing');
const processBlock=background.slice(processStart,processEnd);
const responseCommitted=processBlock.indexOf('DISPATCH_STATUS.RESPONSE_COMMITTED');
const persistPending=processBlock.indexOf('reviewPersistNextTurnPending(pending)');
const finalizeParked=processBlock.indexOf('reviewParkedStore.finalize(envelope.dispatchId)');
assert.ok(responseCommitted>=0,'response commit missing');
assert.ok(persistPending>=0,'continuation persistence missing');
assert.ok(responseCommitted>persistPending,'continuation must be durable before source RESPONSE_COMMITTED');
assert.ok(finalizeParked>responseCommitted,'parked response must finalize only after source commit');

const sendStart=background.indexOf('async function sendToSide');
const sendEnd=background.indexOf('\nasync function openDashboard()',sendStart);
assert.ok(sendStart>=0 && sendEnd>sendStart,'sendToSide block missing');
const sendBlock=background.slice(sendStart,sendEnd);
const accepted=sendBlock.indexOf('DISPATCH_STATUS.ACCEPTED');
const clearPending=sendBlock.indexOf('reviewClearNextTurnPending(continuationSourceDispatchId)');
assert.ok(accepted>=0 && clearPending>accepted,'continuation must not clear before target delivery crosses ACCEPTED');

assert.ok(background.includes('if (state.nextTurnPending) {'));
assert.ok(background.includes('reviewRecoverNextTurnPending()'));
assert.ok(background.includes('source.status !== DISPATCH_STATUS.RESPONSE_COMMITTED'));
assert.ok(background.includes('NO_DURABLE_CONTINUATION'));
assert.ok(background.includes('reviewCommittedWithoutContinuationIsInconsistent'));
assert.ok(background.includes('reviewEnforceContinuationConsistency'));
assert.ok(background.includes('RUNTIME_CONTINUATION_STATE_INCONSISTENT'));

assert.ok(dashboard.includes('runtimePhaseLabel'));
assert.ok(dashboard.includes('recovering next relay turn'));
for(const phase of ['DISPATCHING','AWAITING_PROVIDER_RESPONSE','NEXT_TURN_PENDING','RECOVERING_NEXT_TURN','PAUSED']){
  assert.ok(dashboard.includes(phase),'dashboard missing '+phase);
}

console.log('round28-next-turn-durability: PASS');
