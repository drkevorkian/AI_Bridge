import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const legacy=require('../thread_rollover/thread-rollover.js');
const canonical=require('../thread_rollover/thread-rollover-orchestrator.js');
assert.equal(legacy.ThreadRolloverOrchestrator,canonical.ThreadRolloverOrchestrator);
assert.equal('RolloverTransaction' in legacy,false);
console.log('thread-rollover compatibility: PASS');
