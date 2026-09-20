import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {STATUS,looksLikePromptEcho,AgentParticipationGuard}=require('../team_coordination/agent-participation-guard.js');

class MemoryParticipationStore {
  constructor(){ this.data=new Map(); }
  async load(key){ return this.data.has(key) ? structuredClone(this.data.get(key)) : null; }
  async save(key,value){ this.data.set(key,structuredClone(value)); }
}

const echo='You are AI C. YOUR ASSIGNED JOB: frontend. TEAM ROSTER: A/B/C. TEAM RULES (ALL MEMBERS): security first. PRIMARY OBJECTIVE FROM THE HUMAN CONTROLLER: do work. SHARED UPDATES SINCE YOUR LAST HANDOFF: repeated prompt.';
assert.equal(looksLikePromptEcho(echo),true);

const echoedWithReviewWords=echo+' SHARED UPDATE: AI B CONFIRMED defects, reviewed tests, PASS.';
assert.equal(looksLikePromptEcho(echoedWithReviewWords),true);

const store=new MemoryParticipationStore();
const guard=new AgentParticipationGuard({threshold:3,store});
await guard.init();

assert.equal((await guard.record('C',echo)).status,STATUS.DEGRADED);
assert.equal((await guard.record('C',echo)).status,STATUS.DEGRADED);
assert.equal((await guard.record('C',echo)).status,STATUS.BYPASSED_FOR_GATE);
assert.equal(guard.canProceedWithout('C'),true);
assert.equal(guard.rootIntegrationReviewRequired('C'),true);

const substantive='I reviewed R3-11 through R3-20. CONFIRM R3-11, R3-12, R3-13; found one additional defect and tested it.';
assert.equal((await guard.record('C',substantive)).status,STATUS.ACTIVE);
assert.equal(guard.canProceedWithout('C'),false);

const reloaded=new AgentParticipationGuard({threshold:3,store});
await reloaded.init();
assert.equal(reloaded.canProceedWithout('C'),false,'persisted ACTIVE state should survive guard restart');

console.log('agent-participation-guard: PASS');
