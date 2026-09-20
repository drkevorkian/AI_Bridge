import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {STATUS,looksLikePromptEcho,AgentParticipationGuard}=require('../team_coordination/agent-participation-guard.js');

const echo='You are AI C. YOUR ASSIGNED JOB: frontend. TEAM ROSTER: A/B/C. TEAM RULES (ALL MEMBERS): security first. PRIMARY OBJECTIVE FROM THE HUMAN CONTROLLER: do work. SHARED UPDATES SINCE YOUR LAST HANDOFF: repeated prompt.';
assert.equal(looksLikePromptEcho(echo),true);

const echoedWithReviewWords=echo+' SHARED UPDATE: AI B CONFIRMED defects, reviewed tests, PASS.';
assert.equal(looksLikePromptEcho(echoedWithReviewWords),true);

const persisted=new Map();
const store={
  async load(key){
    return persisted.has(key) ? structuredClone(persisted.get(key)) : null;
  },
  async save(key,value){
    persisted.set(key,structuredClone(value));
  }
};

const guard=new AgentParticipationGuard({threshold:3,store});
await guard.init();

assert.equal((await guard.record('C',echo)).status,STATUS.DEGRADED);
assert.equal((await guard.record('C',echo)).status,STATUS.DEGRADED);
assert.equal((await guard.record('C',echo)).status,STATUS.BYPASSED_FOR_GATE);
assert.equal(guard.canProceedWithout('C'),true);
assert.equal(guard.rootIntegrationReviewRequired('C'),true);

const storedAfterBypass=await store.load('aiBridgeAgentParticipation');
assert.deepEqual(storedAfterBypass.C,{misses:3,status:STATUS.BYPASSED_FOR_GATE});

const substantive='I reviewed R3-11 through R3-20. CONFIRM R3-11, R3-12, R3-13; found one additional defect and tested it.';
assert.equal((await guard.record('C',substantive)).status,STATUS.ACTIVE);
assert.equal(guard.canProceedWithout('C'),false);

const storedAfterRecovery=await store.load('aiBridgeAgentParticipation');
assert.deepEqual(storedAfterRecovery.C,{misses:0,status:STATUS.ACTIVE});

const restored=new AgentParticipationGuard({threshold:3,store});
await restored.init();
assert.equal(restored.canProceedWithout('C'),false);
assert.deepEqual(restored.snapshot(),{C:{misses:0,status:STATUS.ACTIVE}});

console.log('agent-participation-guard: PASS');
