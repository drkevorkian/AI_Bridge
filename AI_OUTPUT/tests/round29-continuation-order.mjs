import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const background=fs.readFileSync(path.resolve(here,'..','runtime_review','background.js'),'utf8');

const processStart=background.indexOf('async function reviewProcessIncomingEnvelope');
const processEnd=background.indexOf('\nasync function reviewDrainParkedResponses',processStart);
assert.ok(processStart>=0 && processEnd>processStart);
const processBlock=background.slice(processStart,processEnd);

const pendingPersist=processBlock.indexOf('await reviewPersistNextTurnPending(pending)');
const responseCommit=processBlock.indexOf('DISPATCH_STATUS.RESPONSE_COMMITTED');
const parkedFinalize=processBlock.indexOf('reviewParkedStore.finalize(envelope.dispatchId)');
assert.ok(pendingPersist>=0);
assert.ok(responseCommit>pendingPersist,'NEXT_TURN_PENDING must be durable before RESPONSE_COMMITTED');
assert.ok(parkedFinalize>responseCommit,'parked response finalizes only after source commit');

assert.ok(processBlock.includes('The source response remains uncommitted'));
assert.ok(processBlock.includes('The next-turn obligation is durable but the source response could not be marked committed'));

assert.ok(background.includes('function reviewCommittedWithoutContinuationIsInconsistent()'));
assert.ok(background.includes('function reviewHasNonterminalDispatch()'));
assert.ok(background.includes('RUNTIME_CONTINUATION_STATE_INCONSISTENT'));
assert.ok(background.includes('await reviewEnforceContinuationConsistency()'));

const consistencyStart=background.indexOf('function reviewCommittedWithoutContinuationIsInconsistent()');
const consistencyEnd=background.indexOf('\nasync function reviewEnforceContinuationConsistency',consistencyStart);
const consistency=background.slice(consistencyStart,consistencyEnd);
assert.ok(consistency.includes('!state.sessionActive'));
assert.ok(consistency.includes('!state.running'));
assert.ok(consistency.includes('state.awaitingHuman'));
assert.ok(consistency.includes('state.nextTurnPending'));
assert.ok(consistency.includes('hasReachedTurnLimit()'));
assert.ok(consistency.includes('reviewHasNonterminalDispatch()'));
assert.ok(consistency.includes('DISPATCH_STATUS.RESPONSE_COMMITTED'));

console.log('round29-continuation-order: PASS');
