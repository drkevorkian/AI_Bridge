"use strict";
const{AUTHORITY_STATES,createConversationAuthority,sameIdentity,sanitizeIdentity}=require("./conversation-authority.js");

const PHASE=Object.freeze({
  IDLE:"IDLE",
  LIMIT_DETECTED:"LIMIT_DETECTED",
  // Compatibility alias for snapshots/tests created before final-response ordering was enforced.
  LIMIT_CONFIRMED:"LIMIT_DETECTED",
  FINAL_RESPONSE_COMMITTED:"FINAL_RESPONSE_COMMITTED",
  CONTINUITY_PREPARED:"CONTINUITY_PREPARED",
  OLD_AUTHORITY_REVOKED:"OLD_AUTHORITY_REVOKED",
  OPENING_NEW_CHAT:"OPENING_NEW_CHAT",
  AWAITING_NEW_IDENTITY:"AWAITING_NEW_IDENTITY",
  NEW_IDENTITY_VERIFIED:"NEW_IDENTITY_VERIFIED",
  CONTINUITY_PENDING:"CONTINUITY_PENDING",
  CONTINUITY_SENT:"CONTINUITY_SENT",
  AWAITING_CONTINUITY_RESPONSE:"AWAITING_CONTINUITY_RESPONSE",
  COMPLETE:"COMPLETE",
  DELIVERY_AMBIGUOUS:"DELIVERY_AMBIGUOUS",
  FAILED:"FAILED"
});
const TRIGGER_MODE=Object.freeze({AUTO:"AUTO",MANUAL:"MANUAL"});
const FINAL_RESPONSE_ANCHOR_KIND=Object.freeze({DISPATCH:"DISPATCH",PROVIDER_SNAPSHOT:"PROVIDER_SNAPSHOT"});
const TRANSITIONS=Object.freeze({
  [PHASE.IDLE]:new Set([PHASE.LIMIT_DETECTED]),
  [PHASE.LIMIT_DETECTED]:new Set([PHASE.FINAL_RESPONSE_COMMITTED,PHASE.FAILED]),
  [PHASE.FINAL_RESPONSE_COMMITTED]:new Set([PHASE.CONTINUITY_PREPARED,PHASE.FAILED]),
  [PHASE.CONTINUITY_PREPARED]:new Set([PHASE.OLD_AUTHORITY_REVOKED,PHASE.FAILED]),
  [PHASE.OLD_AUTHORITY_REVOKED]:new Set([PHASE.OPENING_NEW_CHAT,PHASE.FAILED]),
  [PHASE.OPENING_NEW_CHAT]:new Set([PHASE.AWAITING_NEW_IDENTITY,PHASE.FAILED]),
  [PHASE.AWAITING_NEW_IDENTITY]:new Set([PHASE.NEW_IDENTITY_VERIFIED,PHASE.FAILED]),
  [PHASE.NEW_IDENTITY_VERIFIED]:new Set([PHASE.CONTINUITY_PENDING,PHASE.FAILED]),
  [PHASE.CONTINUITY_PENDING]:new Set([PHASE.CONTINUITY_SENT,PHASE.DELIVERY_AMBIGUOUS,PHASE.FAILED]),
  [PHASE.CONTINUITY_SENT]:new Set([PHASE.AWAITING_CONTINUITY_RESPONSE,PHASE.DELIVERY_AMBIGUOUS,PHASE.FAILED]),
  [PHASE.AWAITING_CONTINUITY_RESPONSE]:new Set([PHASE.COMPLETE,PHASE.DELIVERY_AMBIGUOUS,PHASE.FAILED]),
  [PHASE.COMPLETE]:new Set(),
  [PHASE.DELIVERY_AMBIGUOUS]:new Set([PHASE.FAILED]),
  [PHASE.FAILED]:new Set()
});
const PRE_REVOCATION=new Set([PHASE.LIMIT_DETECTED,PHASE.FINAL_RESPONSE_COMMITTED,PHASE.CONTINUITY_PREPARED]);
const FINAL_RESPONSE_REQUIRED=new Set([
  PHASE.FINAL_RESPONSE_COMMITTED,PHASE.CONTINUITY_PREPARED,PHASE.OLD_AUTHORITY_REVOKED,
  PHASE.OPENING_NEW_CHAT,PHASE.AWAITING_NEW_IDENTITY,PHASE.NEW_IDENTITY_VERIFIED,
  PHASE.CONTINUITY_PENDING,PHASE.CONTINUITY_SENT,PHASE.AWAITING_CONTINUITY_RESPONSE,PHASE.COMPLETE
]);
const CONTINUITY_PAYLOAD_REQUIRED=new Set([
  PHASE.CONTINUITY_PREPARED,PHASE.OLD_AUTHORITY_REVOKED,PHASE.OPENING_NEW_CHAT,
  PHASE.AWAITING_NEW_IDENTITY,PHASE.NEW_IDENTITY_VERIFIED,PHASE.CONTINUITY_PENDING,
  PHASE.CONTINUITY_SENT,PHASE.AWAITING_CONTINUITY_RESPONSE,PHASE.COMPLETE
]);
const CANDIDATE_PHASES=new Set([PHASE.NEW_IDENTITY_VERIFIED,PHASE.CONTINUITY_PENDING,PHASE.CONTINUITY_SENT,PHASE.AWAITING_CONTINUITY_RESPONSE,PHASE.COMPLETE]);
const PROMOTION_PHASES=new Set([PHASE.NEW_IDENTITY_VERIFIED,PHASE.CONTINUITY_PENDING,PHASE.CONTINUITY_SENT,PHASE.AWAITING_CONTINUITY_RESPONSE]);

function text(v,n){const s=String(v??"").trim();if(!s)throw new TypeError(`${n} must be a non-empty string.`);return s;}
function finite(v,n){const x=Number(v);if(!Number.isFinite(x))throw new TypeError(`${n} must be finite.`);return x;}
function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
function normalizePhase(value){const raw=text(value,"phase");return raw==="LIMIT_CONFIRMED"?PHASE.LIMIT_DETECTED:raw;}
function validateOldAuthority(raw,{side,provider}={}){const a=createConversationAuthority(raw);if(a.side!==String(side).toUpperCase())throw new Error("oldAuthority side mismatch.");if(a.identity.provider!==String(provider).toLowerCase())throw new Error("oldAuthority provider mismatch.");if(a.state!==AUTHORITY_STATES.CONFIRMED)throw new Error("rollover must begin from confirmed authority.");return a;}
function confirmedView(authority){const a=createConversationAuthority(authority);return createConversationAuthority({...a,state:AUTHORITY_STATES.CONFIRMED});}
function validateCandidate(oldAuthority,raw){const c=createConversationAuthority(raw);if(c.side!==oldAuthority.side)throw new Error("candidateAuthority side mismatch.");if(c.tabId!==oldAuthority.tabId)throw new Error("candidateAuthority tab mismatch.");if(c.identity.provider!==oldAuthority.identity.provider)throw new Error("candidateAuthority provider mismatch.");if(c.generationEpoch!==oldAuthority.generationEpoch+1)throw new Error("candidateAuthority generation mismatch.");if(c.state===AUTHORITY_STATES.REVOKED)throw new Error("candidateAuthority cannot be revoked.");if(sameIdentity(c.identity,oldAuthority.identity))throw new Error("candidateAuthority did not change conversation identity.");return c;}
function validateEvidence(mode,evidence){if(mode===TRIGGER_MODE.AUTO){if(evidence?.state!=="HARD_THREAD_LIMIT"||evidence?.automaticRollover!==true)throw new Error("AUTO rollover requires authoritative hard-limit evidence.");return clone(evidence);}return evidence==null?null:clone(evidence);}
function validateContinuityPayload(payload){
  if(!payload||typeof payload!=="object"||Array.isArray(payload))throw new TypeError("continuityPayload must be an object.");
  const previousTitle=text(payload.previousTitle,"continuityPayload.previousTitle");
  const nextTitle=text(payload.nextTitle,"continuityPayload.nextTitle");
  const lastAssistantMessage=text(payload.lastAssistantMessage,"continuityPayload.lastAssistantMessage");
  const provider=text(payload.provider,"continuityPayload.provider").toLowerCase();
  const schema=Number(payload.schema);
  if(schema!==1)throw new Error("Unsupported continuityPayload schema.");
  if(previousTitle===nextTitle)throw new Error("continuityPayload must advance the conversation title.");
  return Object.freeze({...clone(payload),schema,provider,previousTitle,nextTitle,lastAssistantMessage});
}
function validateFinalResponseAnchor(raw,provider){
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new TypeError("finalResponseAnchor must be an object.");
  const kind=text(raw.kind,"finalResponseAnchor.kind").toUpperCase();
  if(!Object.values(FINAL_RESPONSE_ANCHOR_KIND).includes(kind))throw new TypeError("finalResponseAnchor.kind is invalid.");
  if(kind===FINAL_RESPONSE_ANCHOR_KIND.DISPATCH){
    return Object.freeze({
      kind,
      dispatchId:text(raw.dispatchId,"finalResponseAnchor.dispatchId"),
      observedAt:finite(raw.observedAt,"finalResponseAnchor.observedAt")
    });
  }
  const contentHash=text(raw.contentHash,"finalResponseAnchor.contentHash").toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(contentHash))throw new TypeError("finalResponseAnchor.contentHash must be a SHA-256 hex digest.");
  const identity=sanitizeIdentity(raw.conversationIdentity);
  if(identity.provider!==String(provider||"").toLowerCase())throw new Error("finalResponseAnchor provider mismatch.");
  if(identity.kind!=="conversation"||identity.provisional||!identity.writable)throw new Error("provider snapshot anchor requires confirmed writable conversation identity.");
  return Object.freeze({
    kind,
    contentHash,
    observedAt:finite(raw.observedAt,"finalResponseAnchor.observedAt"),
    conversationIdentity:identity
  });
}
function authorityShouldBeRevoked(tx){const origin=tx.phase===PHASE.FAILED?tx.failureFromPhase:tx.phase;return !PRE_REVOCATION.has(origin);}
function validatePhase(tx){
  const old=createConversationAuthority(tx.oldAuthority);
  if(tx.phase===PHASE.FAILED){if(!tx.failureFromPhase||!Object.values(PHASE).includes(tx.failureFromPhase)||[PHASE.FAILED,PHASE.COMPLETE].includes(tx.failureFromPhase))throw new Error("FAILED requires valid failureFromPhase.");}
  const mustRevoke=authorityShouldBeRevoked(tx);
  if(mustRevoke&&old.state!==AUTHORITY_STATES.REVOKED)throw new Error("rollover phase requires revoked oldAuthority.");
  if(!mustRevoke&&old.state!==AUTHORITY_STATES.CONFIRMED)throw new Error("pre-revocation phase requires confirmed oldAuthority.");
  if(FINAL_RESPONSE_REQUIRED.has(tx.phase)){
    const anchor=validateFinalResponseAnchor(tx.finalResponseAnchor,tx.provider);
    if(!Number.isFinite(Number(tx.finalResponseCommittedAt)))throw new Error(`${tx.phase} requires finalResponseCommittedAt.`);
    if(anchor.kind===FINAL_RESPONSE_ANCHOR_KIND.DISPATCH){
      if(!tx.finalResponseDispatchId||anchor.dispatchId!==tx.finalResponseDispatchId)throw new Error(`${tx.phase} dispatch anchor does not match finalResponseDispatchId.`);
    }else if(tx.finalResponseDispatchId!==null){
      throw new Error(`${tx.phase} provider snapshot anchor cannot claim a Bridge dispatch.`);
    }
  }
  if(CONTINUITY_PAYLOAD_REQUIRED.has(tx.phase)){
    const payload=validateContinuityPayload(tx.continuityPayload);
    if(payload.provider!==tx.provider)throw new Error("continuityPayload provider mismatch.");
  }
  if(CANDIDATE_PHASES.has(tx.phase)){if(!tx.candidateAuthority)throw new Error(`${tx.phase} requires candidateAuthority.`);validateCandidate(confirmedView(old),tx.candidateAuthority);}
  if([PHASE.CONTINUITY_PENDING,PHASE.CONTINUITY_SENT,PHASE.AWAITING_CONTINUITY_RESPONSE,PHASE.COMPLETE].includes(tx.phase)&&!tx.continuityDispatchId)throw new Error(`${tx.phase} requires continuityDispatchId.`);
  if(tx.phase===PHASE.CONTINUITY_PENDING&&tx.continuityStatus!=="PENDING")throw new Error("CONTINUITY_PENDING requires PENDING status.");
  if([PHASE.CONTINUITY_SENT,PHASE.AWAITING_CONTINUITY_RESPONSE].includes(tx.phase)&&tx.continuityStatus!=="ACCEPTED")throw new Error(`${tx.phase} requires ACCEPTED continuity status.`);
  if(tx.phase===PHASE.COMPLETE){const c=createConversationAuthority(tx.candidateAuthority);if(tx.continuityStatus!=="RESPONSE_ACCEPTED")throw new Error("COMPLETE requires RESPONSE_ACCEPTED continuity status.");if(c.state!==AUTHORITY_STATES.CONFIRMED||c.identity.kind!=="conversation"||c.identity.provisional||!c.identity.writable)throw new Error("COMPLETE requires confirmed writable conversation authority.");}
}
function newTransaction({rolloverId,side,provider,triggeringDispatchId,oldAuthority,hardLimitEvidence,triggerMode=TRIGGER_MODE.AUTO,startedAt=Date.now()}={}){
  const s=text(side,"side").toUpperCase(),p=text(provider,"provider").toLowerCase(),mode=text(triggerMode,"triggerMode").toUpperCase();
  if(!Object.values(TRIGGER_MODE).includes(mode))throw new TypeError("triggerMode is invalid.");
  const old=validateOldAuthority(oldAuthority,{side:s,provider:p});
  const safeStartedAt=finite(startedAt,"startedAt");
  return Object.freeze({
    rolloverId:text(rolloverId,"rolloverId"),side:s,provider:p,triggerMode:mode,
    phase:PHASE.LIMIT_DETECTED,triggeringDispatchId:text(triggeringDispatchId,"triggeringDispatchId"),
    finalResponseDispatchId:null,finalResponseAnchor:null,finalResponseCommittedAt:null,continuityPayload:null,
    continuityDispatchId:null,continuityStatus:null,oldAuthority:clone(old),candidateAuthority:null,
    hardLimitEvidence:validateEvidence(mode,hardLimitEvidence),startedAt:safeStartedAt,updatedAt:safeStartedAt,
    failureReason:"",failureFromPhase:null
  });
}

class RolloverCoordinator{
  constructor(transactions=[]){this._bySide=new Map();for(const tx of transactions)this.restore(tx);}
  begin(input){const tx=newTransaction(input),existing=this._bySide.get(tx.side);if(existing&&![PHASE.COMPLETE,PHASE.FAILED].includes(existing.phase))throw new Error(`AI ${tx.side} already has an active rollover.`);this._bySide.set(tx.side,tx);return tx;}
  restore(raw){
    if(!raw||typeof raw!=="object")throw new TypeError("rollover transaction must be an object.");
    const side=text(raw.side,"side").toUpperCase();
    if(this._bySide.has(side))throw new Error(`Duplicate persisted rollover side: ${side}`);
    const provider=text(raw.provider,"provider").toLowerCase(),phase=normalizePhase(raw.phase),mode=text(raw.triggerMode,"triggerMode").toUpperCase();
    if(!Object.values(PHASE).includes(phase))throw new TypeError(`Unknown rollover phase: ${phase}`);
    if(!Object.values(TRIGGER_MODE).includes(mode))throw new TypeError("triggerMode is invalid.");
    const persistedOld=createConversationAuthority(raw.oldAuthority);
    validateOldAuthority(confirmedView(persistedOld),{side,provider});
    validateEvidence(mode,raw.hardLimitEvidence);
    const legacyLimitOnly=String(raw.phase||"")==="LIMIT_CONFIRMED";
    const tx=Object.freeze({
      rolloverId:text(raw.rolloverId,"rolloverId"),side,provider,triggerMode:mode,phase,
      triggeringDispatchId:text(raw.triggeringDispatchId,"triggeringDispatchId"),
      finalResponseDispatchId:raw.finalResponseDispatchId==null?null:text(raw.finalResponseDispatchId,"finalResponseDispatchId"),
      finalResponseAnchor:raw.finalResponseAnchor==null
        ? (raw.finalResponseDispatchId==null?null:{
            kind:FINAL_RESPONSE_ANCHOR_KIND.DISPATCH,
            dispatchId:text(raw.finalResponseDispatchId,"finalResponseDispatchId"),
            observedAt:finite(raw.finalResponseCommittedAt??raw.updatedAt,"finalResponseAnchor.observedAt")
          })
        : clone(validateFinalResponseAnchor(raw.finalResponseAnchor,provider)),
      finalResponseCommittedAt:raw.finalResponseCommittedAt==null?null:finite(raw.finalResponseCommittedAt,"finalResponseCommittedAt"),
      continuityPayload:raw.continuityPayload==null?null:clone(validateContinuityPayload(raw.continuityPayload)),
      continuityDispatchId:raw.continuityDispatchId==null?null:text(raw.continuityDispatchId,"continuityDispatchId"),
      continuityStatus:raw.continuityStatus==null?null:text(raw.continuityStatus,"continuityStatus"),
      oldAuthority:clone(persistedOld),candidateAuthority:raw.candidateAuthority==null?null:clone(createConversationAuthority(raw.candidateAuthority)),
      hardLimitEvidence:clone(raw.hardLimitEvidence),startedAt:finite(raw.startedAt,"startedAt"),updatedAt:finite(raw.updatedAt,"updatedAt"),
      failureReason:String(raw.failureReason||""),failureFromPhase:raw.failureFromPhase==null?null:normalizePhase(raw.failureFromPhase)
    });
    if(!legacyLimitOnly)validatePhase(tx);else if(persistedOld.state!==AUTHORITY_STATES.CONFIRMED)throw new Error("legacy LIMIT_CONFIRMED requires confirmed oldAuthority.");
    this._bySide.set(side,tx);return tx;
  }
  get(side){return this._bySide.get(String(side||"").toUpperCase())||null;}
  transition(side,nextPhase,patch={},now=Date.now()){
    const cur=this.get(side);if(!cur)throw new Error(`No rollover transaction for AI ${side}.`);
    const next=normalizePhase(nextPhase);
    if(!Object.values(PHASE).includes(next))throw new TypeError(`Unknown rollover phase: ${next}`);
    if(!TRANSITIONS[cur.phase].has(next))throw new Error(`Invalid rollover transition ${cur.phase} -> ${next}.`);
    let cleanPatch={...patch};
    if(next===PHASE.FINAL_RESPONSE_COMMITTED){
      const anchor=patch.finalResponseAnchor
        ? validateFinalResponseAnchor(patch.finalResponseAnchor,cur.provider)
        : validateFinalResponseAnchor({
            kind:FINAL_RESPONSE_ANCHOR_KIND.DISPATCH,
            dispatchId:text(patch.finalResponseDispatchId,"finalResponseDispatchId"),
            observedAt:patch.finalResponseCommittedAt??now
          },cur.provider);
      cleanPatch.finalResponseAnchor=clone(anchor);
      cleanPatch.finalResponseDispatchId=anchor.kind===FINAL_RESPONSE_ANCHOR_KIND.DISPATCH?anchor.dispatchId:null;
      cleanPatch.finalResponseCommittedAt=finite(patch.finalResponseCommittedAt??anchor.observedAt??now,"finalResponseCommittedAt");
    }
    if(next===PHASE.CONTINUITY_PREPARED)cleanPatch.continuityPayload=clone(validateContinuityPayload(patch.continuityPayload));
    if(next===PHASE.OLD_AUTHORITY_REVOKED){
      if(!cur.finalResponseAnchor||cur.finalResponseCommittedAt==null)throw new Error("Old authority cannot be revoked before the final response anchor is durable.");
      validateFinalResponseAnchor(cur.finalResponseAnchor,cur.provider);
      if(!cur.continuityPayload)throw new Error("Old authority cannot be revoked before continuity is prepared.");
      const a=createConversationAuthority(patch.oldAuthority);
      if(a.state!==AUTHORITY_STATES.REVOKED)throw new Error("OLD_AUTHORITY_REVOKED requires revoked oldAuthority.");
      if(a.side!==cur.side||a.tabId!==cur.oldAuthority.tabId||a.generationEpoch!==cur.oldAuthority.generationEpoch||a.identity.provider!==cur.provider)throw new Error("revoked oldAuthority relationship mismatch.");
      cleanPatch.oldAuthority=clone(a);
    }
    if(next===PHASE.NEW_IDENTITY_VERIFIED)cleanPatch.candidateAuthority=clone(validateCandidate(confirmedView(cur.oldAuthority),patch.candidateAuthority));
    if(next===PHASE.CONTINUITY_PENDING){cleanPatch.continuityDispatchId=text(patch.continuityDispatchId,"continuityDispatchId");cleanPatch.continuityStatus="PENDING";}
    if(next===PHASE.CONTINUITY_SENT)cleanPatch.continuityStatus="ACCEPTED";
    if(next===PHASE.COMPLETE)cleanPatch.continuityStatus="RESPONSE_ACCEPTED";
    if(next===PHASE.FAILED)cleanPatch.failureFromPhase=cur.phase;
    const u=Object.freeze({...cur,...clone(cleanPatch),phase:next,updatedAt:finite(now,"updatedAt"),failureReason:patch.failureReason==null?cur.failureReason:String(patch.failureReason)});
    validatePhase(u);this._bySide.set(cur.side,u);return u;
  }
  markFinalResponseCommitted(side,{dispatchId,completedAt=Date.now()}={},now=Date.now()){
    const id=text(dispatchId,"dispatchId");
    const at=finite(completedAt,"completedAt");
    return this.transition(side,PHASE.FINAL_RESPONSE_COMMITTED,{
      finalResponseDispatchId:id,
      finalResponseAnchor:{kind:FINAL_RESPONSE_ANCHOR_KIND.DISPATCH,dispatchId:id,observedAt:at},
      finalResponseCommittedAt:at
    },now);
  }
  anchorProviderSnapshot(side,{contentHash,observedAt=Date.now(),conversationIdentity}={},now=Date.now()){
    const at=finite(observedAt,"observedAt");
    return this.transition(side,PHASE.FINAL_RESPONSE_COMMITTED,{
      finalResponseDispatchId:null,
      finalResponseAnchor:{
        kind:FINAL_RESPONSE_ANCHOR_KIND.PROVIDER_SNAPSHOT,
        contentHash:text(contentHash,"contentHash").toLowerCase(),
        observedAt:at,
        conversationIdentity:sanitizeIdentity(conversationIdentity)
      },
      finalResponseCommittedAt:at
    },now);
  }
  prepareContinuity(side,continuityPayload,now=Date.now()){
    return this.transition(side,PHASE.CONTINUITY_PREPARED,{continuityPayload:validateContinuityPayload(continuityPayload)},now);
  }
  promoteCandidateAuthority(side,confirmedAuthority,now=Date.now()){const cur=this.get(side);if(!cur)throw new Error(`No rollover transaction for AI ${side}.`);if(!PROMOTION_PHASES.has(cur.phase))throw new Error(`Cannot promote candidate during ${cur.phase}.`);if(!cur.candidateAuthority)throw new Error("No candidateAuthority to promote.");const existing=createConversationAuthority(cur.candidateAuthority);if(existing.state!==AUTHORITY_STATES.PROVISIONAL||existing.identity.kind!=="surface")throw new Error("Candidate promotion requires provisional surface authority.");const promoted=validateCandidate(confirmedView(cur.oldAuthority),confirmedAuthority);if(promoted.state!==AUTHORITY_STATES.CONFIRMED||promoted.identity.kind!=="conversation"||promoted.identity.provisional||!promoted.identity.writable)throw new Error("Promotion requires confirmed writable conversation authority.");if(promoted.side!==existing.side||promoted.tabId!==existing.tabId||promoted.generationEpoch!==existing.generationEpoch||promoted.identity.provider!==existing.identity.provider)throw new Error("Promoted authority context mismatch.");const u=Object.freeze({...cur,candidateAuthority:clone(promoted),updatedAt:finite(now,"updatedAt")});validatePhase(u);this._bySide.set(cur.side,u);return u;}
  fail(side,reason,now=Date.now()){const cur=this.get(side);if(!cur)throw new Error(`No rollover transaction for AI ${side}.`);if(cur.phase===PHASE.FAILED)return cur;if(cur.phase===PHASE.COMPLETE)throw new Error("Completed rollover cannot be failed.");return this.transition(side,PHASE.FAILED,{failureReason:text(reason,"failureReason")},now);}
  markAmbiguous(side,reason,now=Date.now()){const cur=this.get(side);if(!cur)throw new Error(`No rollover transaction for AI ${side}.`);if(![PHASE.CONTINUITY_PENDING,PHASE.CONTINUITY_SENT,PHASE.AWAITING_CONTINUITY_RESPONSE].includes(cur.phase))throw new Error(`Cannot mark ${cur.phase} delivery ambiguous.`);return this.transition(side,PHASE.DELIVERY_AMBIGUOUS,{failureReason:text(reason,"reason")},now);}
  canAcceptContinuityResponse({side,rolloverId,dispatchId,observedIdentity}={}){const tx=this.get(side);if(!tx)return{ok:false,reason:"NO_ROLLOVER"};if(tx.rolloverId!==String(rolloverId||""))return{ok:false,reason:"ROLLOVER_MISMATCH"};if(tx.phase!==PHASE.AWAITING_CONTINUITY_RESPONSE)return{ok:false,reason:"WRONG_PHASE"};if(tx.continuityDispatchId!==String(dispatchId||""))return{ok:false,reason:"DISPATCH_MISMATCH"};let observed;try{observed=sanitizeIdentity(observedIdentity);}catch(_){return{ok:false,reason:"MALFORMED_IDENTITY"};}if(!observed.writable)return{ok:false,reason:"READ_ONLY_IDENTITY"};if(observed.provider!==tx.provider)return{ok:false,reason:"PROVIDER_MISMATCH"};if(observed.kind!=="conversation")return{ok:false,reason:"PROVISIONAL_RESPONSE_NOT_AUTHORIZED"};if(sameIdentity(observed,tx.oldAuthority.identity))return{ok:false,reason:"STALE_OLD_CONVERSATION"};if(!tx.candidateAuthority)return{ok:false,reason:"CANDIDATE_AUTHORITY_PENDING"};const candidate=createConversationAuthority(tx.candidateAuthority);if(candidate.state===AUTHORITY_STATES.PROVISIONAL)return{ok:false,reason:"CANDIDATE_CONFIRMATION_PENDING"};if(!sameIdentity(observed,candidate.identity))return{ok:false,reason:"CANDIDATE_IDENTITY_MISMATCH"};return{ok:true,reason:"NEW_CONVERSATION_CONFIRMED"};}
  snapshot(){return[...this._bySide.values()].map(clone);}
}
module.exports={PHASE,TRIGGER_MODE,FINAL_RESPONSE_ANCHOR_KIND,RolloverCoordinator};
