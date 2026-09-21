import assert from "node:assert/strict";
import coordinatorModule from "../thread_rollover/rollover-coordinator.js";

const {PHASE,RolloverCoordinator}=coordinatorModule;

const oldIdentity={provider:"chatgpt",kind:"conversation",routeClass:"conversation",threadKey:"old",writable:true,provisional:false};
const oldAuthority={side:"B",tabId:10,generationEpoch:5,identity:oldIdentity,state:"CONFIRMED"};
const revoked={...oldAuthority,state:"REVOKED"};
const freshSurface={side:"B",tabId:10,generationEpoch:6,identity:{provider:"chatgpt",kind:"surface",routeClass:"home",threadKey:null,writable:true,provisional:true},state:"PROVISIONAL"};
const confirmedConversation={side:"B",tabId:10,generationEpoch:6,identity:{provider:"chatgpt",kind:"conversation",routeClass:"conversation",threadKey:"new",writable:true,provisional:false},state:"CONFIRMED"};
const authoritativeLimitEvidence={
  state:"HARD_THREAD_LIMIT",
  automaticRollover:true,
  signatureId:"chatgpt-max"
};

const coord=new RolloverCoordinator();
coord.begin({
  rolloverId:"r1",
  side:"B",
  provider:"chatgpt",
  triggeringDispatchId:"d-old",
  oldAuthority,
  hardLimitEvidence:authoritativeLimitEvidence,
  startedAt:1
});

assert.throws(()=>coord.transition("B",PHASE.OLD_AUTHORITY_REVOKED,{oldAuthority:revoked},2),/Invalid rollover transition|final response/);
coord.markFinalResponseCommitted("B",{dispatchId:"d-old",completedAt:2},2);
coord.prepareContinuity("B",{schema:1,provider:"chatgpt",previousTitle:"Backend Debug Discovery",nextTitle:"Backend Debug Discovery - II",lastAssistantMessage:"Final committed answer",sourceMessageIndex:0},3);
coord.transition("B",PHASE.OLD_AUTHORITY_REVOKED,{oldAuthority:revoked},4);
coord.transition("B",PHASE.OPENING_NEW_CHAT,{},5);
coord.transition("B",PHASE.AWAITING_NEW_IDENTITY,{},6);
coord.transition("B",PHASE.NEW_IDENTITY_VERIFIED,{candidateAuthority:freshSurface},7);
coord.transition("B",PHASE.CONTINUITY_PENDING,{continuityDispatchId:"d-cont",continuityStatus:"PENDING"},8);
coord.transition("B",PHASE.CONTINUITY_SENT,{continuityStatus:"ACCEPTED"},9);
coord.transition("B",PHASE.AWAITING_CONTINUITY_RESPONSE,{},10);

assert.equal(coord.canAcceptContinuityResponse({side:"B",rolloverId:"r1",dispatchId:"wrong",observedIdentity:{...oldIdentity,threadKey:"new"}}).reason,"DISPATCH_MISMATCH");
assert.equal(coord.canAcceptContinuityResponse({side:"B",rolloverId:"r1",dispatchId:"d-cont",observedIdentity:oldIdentity}).reason,"STALE_OLD_CONVERSATION");
assert.equal(coord.canAcceptContinuityResponse({side:"B",rolloverId:"r1",dispatchId:"d-cont",observedIdentity:{...oldIdentity,kind:"share",writable:false}}).reason,"READ_ONLY_IDENTITY");
assert.equal(
  coord.canAcceptContinuityResponse({side:"B",rolloverId:"r1",dispatchId:"d-cont",observedIdentity:confirmedConversation.identity}).reason,
  "CANDIDATE_CONFIRMATION_PENDING"
);
coord.promoteCandidateAuthority("B",confirmedConversation,11);
assert.equal(
  coord.canAcceptContinuityResponse({side:"B",rolloverId:"r1",dispatchId:"d-cont",observedIdentity:confirmedConversation.identity}).reason,
  "NEW_CONVERSATION_CONFIRMED"
);

const restored=new RolloverCoordinator(coord.snapshot());
assert.equal(restored.get("B").phase,PHASE.AWAITING_CONTINUITY_RESPONSE);

assert.throws(
  ()=>restored.begin({
    rolloverId:"r2",
    side:"B",
    provider:"chatgpt",
    triggeringDispatchId:"d2",
    oldAuthority,
    hardLimitEvidence:{}
  }),
  /authoritative hard-limit evidence/
);

assert.throws(()=>new RolloverCoordinator([...coord.snapshot(),...coord.snapshot()]),/Duplicate persisted rollover side/);

assert.throws(
  ()=>new RolloverCoordinator().begin({
    rolloverId:"rx",
    side:"C",
    provider:"chatgpt",
    triggeringDispatchId:"dx",
    oldAuthority:{...oldAuthority,side:"C"},
    hardLimitEvidence:authoritativeLimitEvidence,
    startedAt:NaN
  }),
  /startedAt must be finite/
);

console.log("exactly-once-rollover: PASS");
