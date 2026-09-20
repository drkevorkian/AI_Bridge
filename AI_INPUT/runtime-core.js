/* Generated review-runtime bundle from exact AI_OUTPUT backend modules. */
(function(root){
  "use strict";
  const factories=Object.create(null),cache=Object.create(null);
  function define(id,factory){factories[id]=factory;}
  function normalize(from,request){
    if(!request.startsWith(".")) return request;
    const parts=from.split("/");parts.pop();
    for(const p of request.split("/")){
      if(!p||p===".")continue;
      if(p==="..")parts.pop(); else parts.push(p);
    }
    return parts.join("/");
  }
  function load(id,from=""){
    const key=normalize(from,id);
    if(cache[key])return cache[key].exports;
    const factory=factories[key];
    if(!factory)throw new Error("Runtime module not found: "+key);
    const module={exports:{}};cache[key]=module;
    factory(module,module.exports,request=>load(request,key));
    return module.exports;
  }

  define("shared/conversation-identity-core.cjs",function(module,exports,require){
"use strict";
function nonEmptyString(value,name){const text=String(value??"").trim();if(!text)throw new TypeError(`${name} must be a non-empty string.`);return text;}
function sanitizeIdentity(identity){
  if(!identity||typeof identity!=="object"||Array.isArray(identity))throw new TypeError("conversation identity must be an object.");
  const provider=nonEmptyString(identity.provider,"identity.provider").toLowerCase();
  const kind=nonEmptyString(identity.kind,"identity.kind");
  const routeClass=nonEmptyString(identity.routeClass,"identity.routeClass");
  const threadKey=identity.threadKey==null?null:nonEmptyString(identity.threadKey,"identity.threadKey");
  const provisional=Boolean(identity.provisional);
  const writable=identity.writable===true;
  if(kind==="conversation"&&!threadKey)throw new TypeError("conversation identity requires threadKey.");
  if(kind!=="conversation"&&threadKey!==null&&kind!=="share")throw new TypeError(`${kind} identity cannot carry threadKey.`);
  if(kind==="share"&&writable)throw new TypeError("share identity cannot be writable.");
  if(kind==="surface"&&!provisional)throw new TypeError("surface identity must be provisional.");
  if(kind==="conversation"&&provisional)throw new TypeError("conversation identity cannot be provisional.");
  return Object.freeze({provider,kind,routeClass,threadKey,provisional,writable});
}
function identityKey(identity){const i=sanitizeIdentity(identity);return[i.provider,i.kind,i.routeClass,i.threadKey||"-",i.provisional?"p":"f",i.writable?"w":"r"].join("|");}
function sameIdentity(a,b){try{return identityKey(a)===identityKey(b);}catch(_){return false;}}
module.exports=Object.freeze({sanitizeIdentity,identityKey,sameIdentity});

  });

  define("thread_rollover/conversation-authority.js",function(module,exports,require){
"use strict";
const{sanitizeIdentity,identityKey,sameIdentity}=require("../shared/conversation-identity-core.cjs");
const AUTHORITY_STATES=Object.freeze({REVOKED:"REVOKED",PROVISIONAL:"PROVISIONAL",CONFIRMED:"CONFIRMED"});
function nonEmptyString(value,name){const text=String(value??"").trim();if(!text)throw new TypeError(`${name} must be a non-empty string.`);return text;}
function positiveInteger(value,name){const n=Number(value);if(!Number.isInteger(n)||n<=0)throw new TypeError(`${name} must be a positive integer.`);return n;}
function nonNegativeInteger(value,name){const n=Number(value);if(!Number.isInteger(n)||n<0)throw new TypeError(`${name} must be a non-negative integer.`);return n;}
function createConversationAuthority({side,tabId,generationEpoch,identity,state}={}){
  const cleanIdentity=sanitizeIdentity(identity),cleanState=nonEmptyString(state,"authority.state");
  if(!Object.values(AUTHORITY_STATES).includes(cleanState))throw new TypeError("authority.state is invalid.");
  if(cleanState===AUTHORITY_STATES.CONFIRMED&&cleanIdentity.kind!=="conversation")throw new TypeError("confirmed authority requires a conversation identity.");
  if(cleanState===AUTHORITY_STATES.PROVISIONAL&&cleanIdentity.kind!=="surface")throw new TypeError("provisional authority requires a surface identity.");
  if(cleanState!==AUTHORITY_STATES.REVOKED&&!cleanIdentity.writable)throw new TypeError("active authority must be writable.");
  return Object.freeze({side:nonEmptyString(side,"authority.side").toUpperCase(),tabId:positiveInteger(tabId,"authority.tabId"),generationEpoch:nonNegativeInteger(generationEpoch,"authority.generationEpoch"),identity:cleanIdentity,state:cleanState});
}
function revokeAuthority(authority){const a=createConversationAuthority(authority);return createConversationAuthority({...a,state:AUTHORITY_STATES.REVOKED});}
function nextGeneration(authority,identity,state=AUTHORITY_STATES.PROVISIONAL){const a=createConversationAuthority(authority);return createConversationAuthority({side:a.side,tabId:a.tabId,generationEpoch:a.generationEpoch+1,identity,state});}
function validateResponseAuthority({authority,senderTabId,side,generationEpoch,conversationIdentity,allowProvisional=false}={}){
  let current,observed;try{current=createConversationAuthority(authority);observed=sanitizeIdentity(conversationIdentity);}catch(error){return{ok:false,reason:"MALFORMED_AUTHORITY",error:error.message};}
  if(current.state===AUTHORITY_STATES.REVOKED)return{ok:false,reason:"AUTHORITY_REVOKED"};
  if(Number(senderTabId)!==current.tabId)return{ok:false,reason:"TAB_MISMATCH"};
  if(String(side||"").toUpperCase()!==current.side)return{ok:false,reason:"SIDE_MISMATCH"};
  if(Number(generationEpoch)!==current.generationEpoch)return{ok:false,reason:"GENERATION_MISMATCH"};
  if(observed.provider!==current.identity.provider)return{ok:false,reason:"PROVIDER_MISMATCH"};
  if(!observed.writable)return{ok:false,reason:"IDENTITY_NOT_WRITABLE"};
  if(current.state===AUTHORITY_STATES.CONFIRMED){if(!sameIdentity(observed,current.identity))return{ok:false,reason:"CONVERSATION_MISMATCH"};return{ok:true,reason:"AUTHORIZED"};}
  if(!allowProvisional)return{ok:false,reason:"PROVISIONAL_NOT_ALLOWED"};
  if(observed.kind!=="surface"&&observed.kind!=="conversation")return{ok:false,reason:"INVALID_PROVISIONAL_IDENTITY"};
  return{ok:true,reason:"AUTHORIZED_PROVISIONAL"};
}
module.exports={AUTHORITY_STATES,sanitizeIdentity,identityKey,sameIdentity,createConversationAuthority,revokeAuthority,nextGeneration,validateResponseAuthority};

  });

  define("thread_rollover/dispatch-ledger.js",function(module,exports,require){
"use strict";
const{sanitizeIdentity,sameIdentity}=require("./conversation-authority.js");
const DISPATCH_STATUS=Object.freeze({CREATED:"CREATED",DISPATCHING:"DISPATCHING",ACCEPTED:"ACCEPTED",AWAITING_RESPONSE:"AWAITING_RESPONSE",RESPONSE_COMMITTED:"RESPONSE_COMMITTED",DELIVERY_AMBIGUOUS:"DELIVERY_AMBIGUOUS",FAILED:"FAILED"});
const PURPOSES=new Set(["INITIAL","RELAY","DIRECT","MANUAL","CONTINUITY","HUMAN_REPLY"]);
const TRANSITIONS=Object.freeze({CREATED:new Set(["DISPATCHING","FAILED"]),DISPATCHING:new Set(["ACCEPTED","DELIVERY_AMBIGUOUS","FAILED"]),ACCEPTED:new Set(["AWAITING_RESPONSE","DELIVERY_AMBIGUOUS","FAILED"]),AWAITING_RESPONSE:new Set(["RESPONSE_COMMITTED","DELIVERY_AMBIGUOUS","FAILED"]),RESPONSE_COMMITTED:new Set(),DELIVERY_AMBIGUOUS:new Set(["FAILED"]),FAILED:new Set()});
function requireText(value,name){const t=String(value??"").trim();if(!t)throw new TypeError(`${name} must be a non-empty string.`);return t;}
function requireInt(value,name,min=0){const n=Number(value);if(!Number.isInteger(n)||n<min)throw new TypeError(`${name} must be an integer >= ${min}.`);return n;}
function validateLifecycle(r){
  const{status,createdAt,acceptedAt,completedAt}=r;
  if(acceptedAt!==null&&acceptedAt<createdAt)throw new Error("acceptedAt cannot precede createdAt.");
  if(completedAt!==null&&acceptedAt===null)throw new Error("completedAt requires acceptedAt.");
  if(completedAt!==null&&completedAt<acceptedAt)throw new Error("completedAt cannot precede acceptedAt.");
  if(status===DISPATCH_STATUS.CREATED&&(acceptedAt!==null||completedAt!==null))throw new Error("CREATED cannot have acceptance/completion timestamps.");
  if(status===DISPATCH_STATUS.DISPATCHING&&completedAt!==null)throw new Error("DISPATCHING cannot have completedAt.");
  if([DISPATCH_STATUS.ACCEPTED,DISPATCH_STATUS.AWAITING_RESPONSE].includes(status)&&(acceptedAt===null||completedAt!==null))throw new Error(`${status} requires acceptedAt and no completedAt.`);
  if(status===DISPATCH_STATUS.RESPONSE_COMMITTED&&(acceptedAt===null||completedAt===null))throw new Error("RESPONSE_COMMITTED requires acceptedAt and completedAt.");
  if(status===DISPATCH_STATUS.DELIVERY_AMBIGUOUS&&completedAt!==null)throw new Error("DELIVERY_AMBIGUOUS cannot have completedAt.");
  return r;
}
function freezeRecord(r){return Object.freeze({...validateLifecycle(r),conversationIdentity:r.conversationIdentity});}
class DispatchLedger{
 constructor(records=[]){this._records=new Map();for(const r of records)this.restore(r);}
 create({dispatchId,side,tabId,generationEpoch,conversationIdentity,purpose,payloadHash,continuationSourceDispatchId=null,createdAt=Date.now()}={}){const id=requireText(dispatchId,"dispatchId");if(this._records.has(id))throw new Error(`Dispatch ${id} already exists.`);const p=requireText(purpose,"purpose").toUpperCase();if(!PURPOSES.has(p))throw new TypeError(`Unsupported dispatch purpose: ${p}`);const sourceId=continuationSourceDispatchId==null?null:requireText(continuationSourceDispatchId,"continuationSourceDispatchId");const r=freezeRecord({dispatchId:id,side:requireText(side,"side").toUpperCase(),tabId:requireInt(tabId,"tabId",1),generationEpoch:requireInt(generationEpoch,"generationEpoch",0),conversationIdentity:sanitizeIdentity(conversationIdentity),purpose:p,payloadHash:requireText(payloadHash,"payloadHash"),continuationSourceDispatchId:sourceId,status:DISPATCH_STATUS.CREATED,createdAt:requireInt(createdAt,"createdAt",0),acceptedAt:null,completedAt:null,failureReason:""});this._records.set(id,r);return r;}
 restore(raw){if(!raw||typeof raw!=="object")throw new TypeError("dispatch record must be an object.");const id=requireText(raw.dispatchId,"dispatchId");if(this._records.has(id))throw new Error(`Duplicate persisted dispatch: ${id}`);const status=requireText(raw.status,"status");if(!Object.values(DISPATCH_STATUS).includes(status))throw new TypeError(`Unknown dispatch status: ${status}`);const p=requireText(raw.purpose,"purpose").toUpperCase();if(!PURPOSES.has(p))throw new TypeError(`Unsupported dispatch purpose: ${p}`);const r=freezeRecord({dispatchId:id,side:requireText(raw.side,"side").toUpperCase(),tabId:requireInt(raw.tabId,"tabId",1),generationEpoch:requireInt(raw.generationEpoch,"generationEpoch",0),conversationIdentity:sanitizeIdentity(raw.conversationIdentity),purpose:p,payloadHash:requireText(raw.payloadHash,"payloadHash"),continuationSourceDispatchId:raw.continuationSourceDispatchId==null?null:requireText(raw.continuationSourceDispatchId,"continuationSourceDispatchId"),status,createdAt:requireInt(raw.createdAt,"createdAt",0),acceptedAt:raw.acceptedAt==null?null:requireInt(raw.acceptedAt,"acceptedAt",0),completedAt:raw.completedAt==null?null:requireInt(raw.completedAt,"completedAt",0),failureReason:String(raw.failureReason||"")});this._records.set(id,r);return r;}
 get(id){return this._records.get(String(id||""))||null;}
 transition(dispatchId,nextStatus,patch={}){const cur=this.get(dispatchId);if(!cur)throw new Error(`Unknown dispatch: ${dispatchId}`);const next=requireText(nextStatus,"nextStatus");if(!Object.values(DISPATCH_STATUS).includes(next))throw new TypeError(`Unknown dispatch status: ${next}`);if(!TRANSITIONS[cur.status].has(next))throw new Error(`Invalid dispatch transition ${cur.status} -> ${next}.`);const u=freezeRecord({...cur,status:next,acceptedAt:patch.acceptedAt==null?cur.acceptedAt:requireInt(patch.acceptedAt,"acceptedAt",0),completedAt:patch.completedAt==null?cur.completedAt:requireInt(patch.completedAt,"completedAt",0),failureReason:patch.failureReason==null?cur.failureReason:String(patch.failureReason)});this._records.set(cur.dispatchId,u);return u;}
 recoverAcceptedAfterRestart(dispatchId,{contentProof=null,recoveredAt=Date.now()}={}){
  const cur=this.get(dispatchId);
  if(!cur)throw new Error(`Unknown dispatch: ${dispatchId}`);

  if(cur.status===DISPATCH_STATUS.ACCEPTED){
    return this.transition(cur.dispatchId,DISPATCH_STATUS.AWAITING_RESPONSE,{failureReason:""});
  }

  if(cur.status!==DISPATCH_STATUS.DELIVERY_AMBIGUOUS)throw new Error(`Dispatch ${cur.dispatchId} is not restart-recoverable from ${cur.status}.`);
  if(cur.failureReason!=="MV3_WORKER_RESTART_DURING_DELIVERY")throw new Error("Only worker-restart delivery ambiguity can be recovered automatically.");

  let acceptedAt=cur.acceptedAt;
  if(acceptedAt===null){
    if(!contentProof||typeof contentProof!=="object")throw new Error("Content action proof is required for a restart-ambiguous DISPATCHING record.");
    if(String(contentProof.authorityId||"")!==cur.dispatchId)throw new Error("Content proof authority does not match dispatch.");
    if(String(contentProof.action||"").toUpperCase()!=="SEND")throw new Error("Content proof action must be SEND.");
    if(String(contentProof.outcome||"")!=="ACTION_CONFIRMED")throw new Error("Content proof does not confirm provider action.");
    if(String(contentProof.side||"").toUpperCase()!==cur.side)throw new Error("Content proof side does not match dispatch.");
    if(Number(contentProof.generationEpoch)!==cur.generationEpoch)throw new Error("Content proof generation does not match dispatch.");
    let observed;
    try{observed=sanitizeIdentity(contentProof.conversationIdentity);}catch(_){throw new Error("Content proof conversation identity is malformed.");}
    if(!sameIdentity(observed,cur.conversationIdentity))throw new Error("Content proof conversation does not match dispatch.");
    acceptedAt=requireInt(recoveredAt,"recoveredAt",cur.createdAt);
  }

  const recovered=freezeRecord({...cur,status:DISPATCH_STATUS.AWAITING_RESPONSE,acceptedAt,completedAt:null,failureReason:""});
  this._records.set(cur.dispatchId,recovered);
  return recovered;
 }
 validateResponse({dispatchId,side,tabId,generationEpoch,conversationIdentity}={}){const r=this.get(dispatchId);if(!r)return{ok:false,reason:"UNKNOWN_DISPATCH"};if(r.status!==DISPATCH_STATUS.AWAITING_RESPONSE)return{ok:false,reason:"DISPATCH_NOT_AWAITING_RESPONSE"};if(String(side||"").toUpperCase()!==r.side)return{ok:false,reason:"SIDE_MISMATCH"};if(Number(tabId)!==r.tabId)return{ok:false,reason:"TAB_MISMATCH"};if(Number(generationEpoch)!==r.generationEpoch)return{ok:false,reason:"GENERATION_MISMATCH"};let o;try{o=sanitizeIdentity(conversationIdentity);}catch(_){return{ok:false,reason:"MALFORMED_IDENTITY"};}const e=r.conversationIdentity;if(o.provider!==e.provider)return{ok:false,reason:"PROVIDER_MISMATCH"};if(!o.writable)return{ok:false,reason:"IDENTITY_NOT_WRITABLE"};if(e.kind==="conversation"&&!sameIdentity(o,e))return{ok:false,reason:"CONVERSATION_MISMATCH"};if(e.kind==="surface"&&o.kind!=="surface"&&o.kind!=="conversation")return{ok:false,reason:"SURFACE_TRANSITION_INVALID"};return{ok:true,reason:"AUTHORIZED"};}
 snapshot(){return[...this._records.values()].map(r=>({...r,conversationIdentity:{...r.conversationIdentity}}));}
}
module.exports={DISPATCH_STATUS,DispatchLedger};


  });

  define("thread_rollover/rollover-coordinator.js",function(module,exports,require){
"use strict";
const{AUTHORITY_STATES,createConversationAuthority,sameIdentity,sanitizeIdentity}=require("./conversation-authority.js");
const PHASE=Object.freeze({IDLE:"IDLE",LIMIT_CONFIRMED:"LIMIT_CONFIRMED",OLD_AUTHORITY_REVOKED:"OLD_AUTHORITY_REVOKED",OPENING_NEW_CHAT:"OPENING_NEW_CHAT",AWAITING_NEW_IDENTITY:"AWAITING_NEW_IDENTITY",NEW_IDENTITY_VERIFIED:"NEW_IDENTITY_VERIFIED",CONTINUITY_PENDING:"CONTINUITY_PENDING",CONTINUITY_SENT:"CONTINUITY_SENT",AWAITING_CONTINUITY_RESPONSE:"AWAITING_CONTINUITY_RESPONSE",COMPLETE:"COMPLETE",DELIVERY_AMBIGUOUS:"DELIVERY_AMBIGUOUS",FAILED:"FAILED"});
const TRIGGER_MODE=Object.freeze({AUTO:"AUTO",MANUAL:"MANUAL"});
const TRANSITIONS=Object.freeze({IDLE:new Set(["LIMIT_CONFIRMED"]),LIMIT_CONFIRMED:new Set(["OLD_AUTHORITY_REVOKED","FAILED"]),OLD_AUTHORITY_REVOKED:new Set(["OPENING_NEW_CHAT","FAILED"]),OPENING_NEW_CHAT:new Set(["AWAITING_NEW_IDENTITY","FAILED"]),AWAITING_NEW_IDENTITY:new Set(["NEW_IDENTITY_VERIFIED","FAILED"]),NEW_IDENTITY_VERIFIED:new Set(["CONTINUITY_PENDING","FAILED"]),CONTINUITY_PENDING:new Set(["CONTINUITY_SENT","DELIVERY_AMBIGUOUS","FAILED"]),CONTINUITY_SENT:new Set(["AWAITING_CONTINUITY_RESPONSE","DELIVERY_AMBIGUOUS","FAILED"]),AWAITING_CONTINUITY_RESPONSE:new Set(["COMPLETE","DELIVERY_AMBIGUOUS","FAILED"]),COMPLETE:new Set(),DELIVERY_AMBIGUOUS:new Set(["FAILED"]),FAILED:new Set()});
const PRE_REVOCATION=new Set([PHASE.LIMIT_CONFIRMED]);
const CANDIDATE_PHASES=new Set([PHASE.NEW_IDENTITY_VERIFIED,PHASE.CONTINUITY_PENDING,PHASE.CONTINUITY_SENT,PHASE.AWAITING_CONTINUITY_RESPONSE,PHASE.COMPLETE]);
const PROMOTION_PHASES=new Set([PHASE.NEW_IDENTITY_VERIFIED,PHASE.CONTINUITY_PENDING,PHASE.CONTINUITY_SENT,PHASE.AWAITING_CONTINUITY_RESPONSE]);
function text(v,n){const s=String(v??"").trim();if(!s)throw new TypeError(`${n} must be a non-empty string.`);return s;}
function finite(v,n){const x=Number(v);if(!Number.isFinite(x))throw new TypeError(`${n} must be finite.`);return x;}
function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
function validateOldAuthority(raw,{side,provider}={}){const a=createConversationAuthority(raw);if(a.side!==String(side).toUpperCase())throw new Error("oldAuthority side mismatch.");if(a.identity.provider!==String(provider).toLowerCase())throw new Error("oldAuthority provider mismatch.");if(a.state!==AUTHORITY_STATES.CONFIRMED)throw new Error("rollover must begin from confirmed authority.");return a;}
function confirmedView(authority){const a=createConversationAuthority(authority);return createConversationAuthority({...a,state:AUTHORITY_STATES.CONFIRMED});}
function validateCandidate(oldAuthority,raw){const c=createConversationAuthority(raw);if(c.side!==oldAuthority.side)throw new Error("candidateAuthority side mismatch.");if(c.tabId!==oldAuthority.tabId)throw new Error("candidateAuthority tab mismatch.");if(c.identity.provider!==oldAuthority.identity.provider)throw new Error("candidateAuthority provider mismatch.");if(c.generationEpoch!==oldAuthority.generationEpoch+1)throw new Error("candidateAuthority generation mismatch.");if(c.state===AUTHORITY_STATES.REVOKED)throw new Error("candidateAuthority cannot be revoked.");if(sameIdentity(c.identity,oldAuthority.identity))throw new Error("candidateAuthority did not change conversation identity.");return c;}
function validateEvidence(mode,evidence){if(mode===TRIGGER_MODE.AUTO){if(evidence?.state!=="HARD_THREAD_LIMIT"||evidence?.automaticRollover!==true)throw new Error("AUTO rollover requires authoritative hard-limit evidence.");return clone(evidence);}return evidence==null?null:clone(evidence);}
function authorityShouldBeRevoked(tx){const origin=tx.phase===PHASE.FAILED?tx.failureFromPhase:tx.phase;return !PRE_REVOCATION.has(origin);}
function validatePhase(tx){
  const old=createConversationAuthority(tx.oldAuthority);
  if(tx.phase===PHASE.FAILED){if(!tx.failureFromPhase||!Object.values(PHASE).includes(tx.failureFromPhase)||[PHASE.FAILED,PHASE.COMPLETE].includes(tx.failureFromPhase))throw new Error("FAILED requires valid failureFromPhase.");}
  const mustRevoke=authorityShouldBeRevoked(tx);
  if(mustRevoke&&old.state!==AUTHORITY_STATES.REVOKED)throw new Error("rollover phase requires revoked oldAuthority.");
  if(!mustRevoke&&old.state!==AUTHORITY_STATES.CONFIRMED)throw new Error("pre-revocation phase requires confirmed oldAuthority.");
  if(CANDIDATE_PHASES.has(tx.phase)){if(!tx.candidateAuthority)throw new Error(`${tx.phase} requires candidateAuthority.`);validateCandidate(confirmedView(old),tx.candidateAuthority);}
  if([PHASE.CONTINUITY_PENDING,PHASE.CONTINUITY_SENT,PHASE.AWAITING_CONTINUITY_RESPONSE,PHASE.COMPLETE].includes(tx.phase)&&!tx.continuityDispatchId)throw new Error(`${tx.phase} requires continuityDispatchId.`);
  if(tx.phase===PHASE.CONTINUITY_PENDING&&tx.continuityStatus!=="PENDING")throw new Error("CONTINUITY_PENDING requires PENDING status.");
  if([PHASE.CONTINUITY_SENT,PHASE.AWAITING_CONTINUITY_RESPONSE].includes(tx.phase)&&tx.continuityStatus!=="ACCEPTED")throw new Error(`${tx.phase} requires ACCEPTED continuity status.`);
  if(tx.phase===PHASE.COMPLETE){const c=createConversationAuthority(tx.candidateAuthority);if(tx.continuityStatus!=="RESPONSE_ACCEPTED")throw new Error("COMPLETE requires RESPONSE_ACCEPTED continuity status.");if(c.state!==AUTHORITY_STATES.CONFIRMED||c.identity.kind!=="conversation"||c.identity.provisional||!c.identity.writable)throw new Error("COMPLETE requires confirmed writable conversation authority.");}
}
function newTransaction({rolloverId,side,provider,triggeringDispatchId,oldAuthority,hardLimitEvidence,triggerMode=TRIGGER_MODE.AUTO,startedAt=Date.now()}={}){const s=text(side,"side").toUpperCase(),p=text(provider,"provider").toLowerCase(),mode=text(triggerMode,"triggerMode").toUpperCase();if(!Object.values(TRIGGER_MODE).includes(mode))throw new TypeError("triggerMode is invalid.");const old=validateOldAuthority(oldAuthority,{side:s,provider:p});const safeStartedAt=finite(startedAt,"startedAt");return Object.freeze({rolloverId:text(rolloverId,"rolloverId"),side:s,provider:p,triggerMode:mode,phase:PHASE.LIMIT_CONFIRMED,triggeringDispatchId:text(triggeringDispatchId,"triggeringDispatchId"),continuityDispatchId:null,continuityStatus:null,oldAuthority:clone(old),candidateAuthority:null,hardLimitEvidence:validateEvidence(mode,hardLimitEvidence),startedAt:safeStartedAt,updatedAt:safeStartedAt,failureReason:"",failureFromPhase:null});}
class RolloverCoordinator{
 constructor(transactions=[]){this._bySide=new Map();for(const tx of transactions)this.restore(tx);}
 begin(input){const tx=newTransaction(input),existing=this._bySide.get(tx.side);if(existing&&![PHASE.COMPLETE,PHASE.FAILED].includes(existing.phase))throw new Error(`AI ${tx.side} already has an active rollover.`);this._bySide.set(tx.side,tx);return tx;}
 restore(raw){if(!raw||typeof raw!=="object")throw new TypeError("rollover transaction must be an object.");const side=text(raw.side,"side").toUpperCase();if(this._bySide.has(side))throw new Error(`Duplicate persisted rollover side: ${side}`);const provider=text(raw.provider,"provider").toLowerCase(),phase=text(raw.phase,"phase"),mode=text(raw.triggerMode,"triggerMode").toUpperCase();if(!Object.values(PHASE).includes(phase))throw new TypeError(`Unknown rollover phase: ${phase}`);if(!Object.values(TRIGGER_MODE).includes(mode))throw new TypeError("triggerMode is invalid.");const persistedOld=createConversationAuthority(raw.oldAuthority);validateOldAuthority(confirmedView(persistedOld),{side,provider});validateEvidence(mode,raw.hardLimitEvidence);const tx=Object.freeze({rolloverId:text(raw.rolloverId,"rolloverId"),side,provider,triggerMode:mode,phase,triggeringDispatchId:text(raw.triggeringDispatchId,"triggeringDispatchId"),continuityDispatchId:raw.continuityDispatchId==null?null:text(raw.continuityDispatchId,"continuityDispatchId"),continuityStatus:raw.continuityStatus==null?null:text(raw.continuityStatus,"continuityStatus"),oldAuthority:clone(persistedOld),candidateAuthority:raw.candidateAuthority==null?null:clone(createConversationAuthority(raw.candidateAuthority)),hardLimitEvidence:clone(raw.hardLimitEvidence),startedAt:finite(raw.startedAt,"startedAt"),updatedAt:finite(raw.updatedAt,"updatedAt"),failureReason:String(raw.failureReason||""),failureFromPhase:raw.failureFromPhase==null?null:text(raw.failureFromPhase,"failureFromPhase")});validatePhase(tx);this._bySide.set(side,tx);return tx;}
 get(side){return this._bySide.get(String(side||"").toUpperCase())||null;}
 transition(side,nextPhase,patch={},now=Date.now()){const cur=this.get(side);if(!cur)throw new Error(`No rollover transaction for AI ${side}.`);const next=text(nextPhase,"nextPhase");if(!Object.values(PHASE).includes(next))throw new TypeError(`Unknown rollover phase: ${next}`);if(!TRANSITIONS[cur.phase].has(next))throw new Error(`Invalid rollover transition ${cur.phase} -> ${next}.`);let cleanPatch={...patch};if(next===PHASE.OLD_AUTHORITY_REVOKED){const a=createConversationAuthority(patch.oldAuthority);if(a.state!==AUTHORITY_STATES.REVOKED)throw new Error("OLD_AUTHORITY_REVOKED requires revoked oldAuthority.");if(a.side!==cur.side||a.tabId!==cur.oldAuthority.tabId||a.generationEpoch!==cur.oldAuthority.generationEpoch||a.identity.provider!==cur.provider)throw new Error("revoked oldAuthority relationship mismatch.");cleanPatch.oldAuthority=clone(a);}if(next===PHASE.NEW_IDENTITY_VERIFIED)cleanPatch.candidateAuthority=clone(validateCandidate(confirmedView(cur.oldAuthority),patch.candidateAuthority));if(next===PHASE.CONTINUITY_PENDING){cleanPatch.continuityDispatchId=text(patch.continuityDispatchId,"continuityDispatchId");cleanPatch.continuityStatus="PENDING";}if(next===PHASE.CONTINUITY_SENT)cleanPatch.continuityStatus="ACCEPTED";if(next===PHASE.COMPLETE)cleanPatch.continuityStatus="RESPONSE_ACCEPTED";if(next===PHASE.FAILED)cleanPatch.failureFromPhase=cur.phase;const u=Object.freeze({...cur,...clone(cleanPatch),phase:next,updatedAt:finite(now,"updatedAt"),failureReason:patch.failureReason==null?cur.failureReason:String(patch.failureReason)});validatePhase(u);this._bySide.set(cur.side,u);return u;}
 promoteCandidateAuthority(side,confirmedAuthority,now=Date.now()){const cur=this.get(side);if(!cur)throw new Error(`No rollover transaction for AI ${side}.`);if(!PROMOTION_PHASES.has(cur.phase))throw new Error(`Cannot promote candidate during ${cur.phase}.`);if(!cur.candidateAuthority)throw new Error("No candidateAuthority to promote.");const existing=createConversationAuthority(cur.candidateAuthority);if(existing.state!==AUTHORITY_STATES.PROVISIONAL||existing.identity.kind!=="surface")throw new Error("Candidate promotion requires provisional surface authority.");const promoted=validateCandidate(confirmedView(cur.oldAuthority),confirmedAuthority);if(promoted.state!==AUTHORITY_STATES.CONFIRMED||promoted.identity.kind!=="conversation"||promoted.identity.provisional||!promoted.identity.writable)throw new Error("Promotion requires confirmed writable conversation authority.");if(promoted.side!==existing.side||promoted.tabId!==existing.tabId||promoted.generationEpoch!==existing.generationEpoch||promoted.identity.provider!==existing.identity.provider)throw new Error("Promoted authority context mismatch.");const u=Object.freeze({...cur,candidateAuthority:clone(promoted),updatedAt:finite(now,"updatedAt")});validatePhase(u);this._bySide.set(cur.side,u);return u;}
 fail(side,reason,now=Date.now()){const cur=this.get(side);if(!cur)throw new Error(`No rollover transaction for AI ${side}.`);if(cur.phase===PHASE.FAILED)return cur;if(cur.phase===PHASE.COMPLETE)throw new Error("Completed rollover cannot be failed.");return this.transition(side,PHASE.FAILED,{failureReason:text(reason,"failureReason")},now);}
 markAmbiguous(side,reason,now=Date.now()){const cur=this.get(side);if(!cur)throw new Error(`No rollover transaction for AI ${side}.`);if(![PHASE.CONTINUITY_PENDING,PHASE.CONTINUITY_SENT,PHASE.AWAITING_CONTINUITY_RESPONSE].includes(cur.phase))throw new Error(`Cannot mark ${cur.phase} delivery ambiguous.`);return this.transition(side,PHASE.DELIVERY_AMBIGUOUS,{failureReason:text(reason,"reason")},now);}
 canAcceptContinuityResponse({side,rolloverId,dispatchId,observedIdentity}={}){const tx=this.get(side);if(!tx)return{ok:false,reason:"NO_ROLLOVER"};if(tx.rolloverId!==String(rolloverId||""))return{ok:false,reason:"ROLLOVER_MISMATCH"};if(tx.phase!==PHASE.AWAITING_CONTINUITY_RESPONSE)return{ok:false,reason:"WRONG_PHASE"};if(tx.continuityDispatchId!==String(dispatchId||""))return{ok:false,reason:"DISPATCH_MISMATCH"};let observed;try{observed=sanitizeIdentity(observedIdentity);}catch(_){return{ok:false,reason:"MALFORMED_IDENTITY"};}if(!observed.writable)return{ok:false,reason:"READ_ONLY_IDENTITY"};if(observed.provider!==tx.provider)return{ok:false,reason:"PROVIDER_MISMATCH"};if(observed.kind!=="conversation")return{ok:false,reason:"PROVISIONAL_RESPONSE_NOT_AUTHORIZED"};if(sameIdentity(observed,tx.oldAuthority.identity))return{ok:false,reason:"STALE_OLD_CONVERSATION"};if(!tx.candidateAuthority)return{ok:false,reason:"CANDIDATE_AUTHORITY_PENDING"};const candidate=createConversationAuthority(tx.candidateAuthority);if(candidate.state===AUTHORITY_STATES.PROVISIONAL)return{ok:false,reason:"CANDIDATE_CONFIRMATION_PENDING"};if(!sameIdentity(observed,candidate.identity))return{ok:false,reason:"CANDIDATE_IDENTITY_MISMATCH"};return{ok:true,reason:"NEW_CONVERSATION_CONFIRMED"};}
 snapshot(){return[...this._bySide.values()].map(clone);}
}
module.exports={PHASE,TRIGGER_MODE,RolloverCoordinator};

  });

  define("thread_rollover/incoming-response-gate.js",function(module,exports,require){
"use strict";
const{DISPATCH_STATUS}=require("./dispatch-ledger.js");
const{PHASE}=require("./rollover-coordinator.js");
const{AUTHORITY_STATES,createConversationAuthority,sanitizeIdentity,validateResponseAuthority,sameIdentity}=require("./conversation-authority.js");
const DISPOSITION=Object.freeze({COMMIT:"COMMIT",DROP:"DROP",PARK:"PARK",PAUSE:"PAUSE"});
function result(disposition,reason){return Object.freeze({ok:disposition===DISPOSITION.COMMIT,disposition,reason});}
function validateIncomingResponse({ledger,coordinator,authority,senderTabId,side,dispatchId,generationEpoch,conversationIdentity,rolloverId=null}={}){
  if(!ledger||typeof ledger.get!=="function"||typeof ledger.validateResponse!=="function")return result(DISPOSITION.PAUSE,"LEDGER_UNAVAILABLE");
  const dispatch=ledger.get(dispatchId);if(!dispatch)return result(DISPOSITION.DROP,"UNKNOWN_DISPATCH");
  if(dispatch.status===DISPATCH_STATUS.DELIVERY_AMBIGUOUS)return result(DISPOSITION.PAUSE,"DELIVERY_AMBIGUOUS");
  const ledgerAuth=ledger.validateResponse({dispatchId,side,tabId:senderTabId,generationEpoch,conversationIdentity});
  if(!ledgerAuth.ok)return result(DISPOSITION.DROP,ledgerAuth.reason);
  let observed;try{observed=sanitizeIdentity(conversationIdentity);}catch(_){return result(DISPOSITION.DROP,"MALFORMED_IDENTITY");}
  if(dispatch.purpose!=="CONTINUITY"){const auth=validateResponseAuthority({authority,senderTabId,side,generationEpoch,conversationIdentity:observed});return auth.ok?result(DISPOSITION.COMMIT,"AUTHORIZED"):result(DISPOSITION.DROP,auth.reason);}
  if(!coordinator||typeof coordinator.get!=="function")return result(DISPOSITION.PAUSE,"ROLLOVER_UNAVAILABLE");
  const tx=coordinator.get(side);if(!tx)return result(DISPOSITION.PAUSE,"ROLLOVER_REQUIRED");
  if(rolloverId!=null&&tx.rolloverId!==String(rolloverId))return result(DISPOSITION.DROP,"ROLLOVER_MISMATCH");
  if(tx.phase===PHASE.DELIVERY_AMBIGUOUS)return result(DISPOSITION.PAUSE,"DELIVERY_AMBIGUOUS");
  if(tx.continuityDispatchId&&tx.continuityDispatchId!==String(dispatchId))return result(DISPOSITION.DROP,"DISPATCH_MISMATCH");
  if(sameIdentity(observed,tx.oldAuthority?.identity))return result(DISPOSITION.DROP,"STALE_OLD_CONVERSATION");
  if(tx.phase!==PHASE.AWAITING_CONTINUITY_RESPONSE)return result(DISPOSITION.PARK,"ROLLOVER_NOT_READY");
  if(!tx.candidateAuthority)return result(DISPOSITION.PARK,"CANDIDATE_AUTHORITY_PENDING");
  const candidate=createConversationAuthority(tx.candidateAuthority);
  if(candidate.state===AUTHORITY_STATES.PROVISIONAL){
    if(observed.kind==="conversation"&&observed.provider===candidate.identity.provider&&observed.writable&&!sameIdentity(observed,tx.oldAuthority.identity))return result(DISPOSITION.PARK,"CANDIDATE_CONFIRMATION_PENDING");
    return result(DISPOSITION.DROP,"CANDIDATE_IDENTITY_MISMATCH");
  }
  if(!sameIdentity(observed,candidate.identity))return result(DISPOSITION.DROP,"CANDIDATE_IDENTITY_MISMATCH");
  const auth=validateResponseAuthority({authority:candidate,senderTabId,side,generationEpoch,conversationIdentity:observed});
  if(!auth.ok)return result(DISPOSITION.DROP,auth.reason);
  return result(DISPOSITION.COMMIT,"AUTHORIZED_CONTINUITY_RESPONSE");
}
module.exports={DISPOSITION,validateIncomingResponse};

  });

  define("thread_rollover/parked-response-store.js",function(module,exports,require){
"use strict";

const RECORD_STATE=Object.freeze({PARKED:"PARKED",CLAIMED:"CLAIMED"});
const RECONCILE=Object.freeze({CLEARED:"CLEARED",PAUSE:"PAUSE",NONE:"NONE"});
const RELEASE_REASON=Object.freeze({RELEASED:"RELEASED",NOT_FOUND:"NOT_FOUND",NOT_CLAIMED:"NOT_CLAIMED",CLAIM_EXPIRED_RECONCILIATION_REQUIRED:"CLAIM_EXPIRED_RECONCILIATION_REQUIRED"});
const STORE_ERROR_CODE=Object.freeze({
  RECOVERY_LOAD_FAILED:"RECOVERY_LOAD_FAILED",
  RECOVERY_ENTRY_LIMIT_EXCEEDED:"RECOVERY_ENTRY_LIMIT_EXCEEDED",
  RECOVERY_TOTAL_BYTES_EXCEEDED:"RECOVERY_TOTAL_BYTES_EXCEEDED",
  RECOVERY_DUPLICATE_DISPATCH:"RECOVERY_DUPLICATE_DISPATCH",
  RECOVERY_SCHEMA_INVALID:"RECOVERY_SCHEMA_INVALID",
  RECOVERY_PERSIST_FAILED:"RECOVERY_PERSIST_FAILED",
  MUTATION_PERSIST_FAILED:"MUTATION_PERSIST_FAILED"
});
const TERMINAL_DISPATCH=new Set(["RESPONSE_COMMITTED","FAILED"]);

function text(value,name){const s=String(value??"").trim();if(!s)throw new TypeError(`${name} must be a non-empty string.`);return s;}
function integer(value,name,min){const n=Number(value);if(!Number.isInteger(n)||n<min)throw new TypeError(`${name} must be an integer >= ${min}.`);return n;}
function byteLength(value){const s=JSON.stringify(value);return typeof Buffer!=="undefined"?Buffer.byteLength(s,"utf8"):new TextEncoder().encode(s).length;}
function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}

class ParkedResponseStoreError extends Error{
  constructor(code,message,cause=null){super(String(message||code));this.name="ParkedResponseStoreError";this.code=text(code,"code");if(cause!=null)this.cause=cause;}
}

class ParkedResponseStore{
  constructor({store,key="aiBridgeParkedResponses",maxEntries=8,maxBytes=262144,maxTotalBytes=null,ttlMs=15000,now=()=>Date.now()}={}){
    if(!store||typeof store.load!=="function"||typeof store.save!=="function")throw new TypeError("store with async load/save is required.");
    if(typeof now!=="function")throw new TypeError("now must be a function.");
    this.store=store;
    this.key=text(key,"key");
    this.maxEntries=integer(maxEntries,"maxEntries",1);
    this.maxBytes=integer(maxBytes,"maxBytes",1024);
    this.maxTotalBytes=maxTotalBytes==null?this.maxBytes*this.maxEntries:integer(maxTotalBytes,"maxTotalBytes",1);
    this.ttlMs=integer(ttlMs,"ttlMs",1000);
    this.now=now;
    this.records=new Map();
    this.initialized=false;
    this._queue=Promise.resolve();
  }

  async init(){
    return this._serialize(async()=>{
      this.initialized=false;
      this.records.clear();
      let raw;
      try{raw=await this.store.load(this.key);}catch(error){throw new ParkedResponseStoreError(STORE_ERROR_CODE.RECOVERY_LOAD_FAILED,"Failed to load persisted parked-response state.",error);}
      const items=Array.isArray(raw?.records)?raw.records:[];
      if(items.length>this.maxEntries)throw new ParkedResponseStoreError(STORE_ERROR_CODE.RECOVERY_ENTRY_LIMIT_EXCEEDED,"Persisted parked-response count exceeds maxEntries.");
      const candidate=new Map();
      for(const item of items){
        let record;
        try{record=this._sanitizeRecord(item);}catch(error){throw new ParkedResponseStoreError(STORE_ERROR_CODE.RECOVERY_SCHEMA_INVALID,"Persisted parked-response record failed validation.",error);}
        if(candidate.has(record.dispatchId))throw new ParkedResponseStoreError(STORE_ERROR_CODE.RECOVERY_DUPLICATE_DISPATCH,`Duplicate persisted parked response: ${record.dispatchId}`);
        candidate.set(record.dispatchId,record);
      }
      const changed=this._pruneExpiredParked(candidate);
      if(!this._fitsAggregateBudget(candidate))throw new ParkedResponseStoreError(STORE_ERROR_CODE.RECOVERY_TOTAL_BYTES_EXCEEDED,"Persisted parked-response store exceeds maxTotalBytes.");
      if(changed){try{await this._persistMap(candidate);}catch(error){throw new ParkedResponseStoreError(STORE_ERROR_CODE.RECOVERY_PERSIST_FAILED,"Failed to persist recovered parked-response state.",error);}}
      this.records=candidate;
      this.initialized=true;
      return this.snapshot();
    },false).catch(error=>{
      this.records.clear();
      this.initialized=false;
      throw error;
    });
  }

  async park(dispatchId,envelope){
    return this._serialize(async()=>{
      const candidate=this._candidateWithPrunedParked();
      const id=text(dispatchId,"dispatchId");
      if(candidate.has(id))return Object.freeze({stored:false,reason:"ALREADY_PARKED",pause:false});
      if(candidate.size>=this.maxEntries)return Object.freeze({stored:false,reason:"STORE_FULL",pause:true});
      const cleanEnvelope=clone(envelope??null);
      if(byteLength(cleanEnvelope)>this.maxBytes)return Object.freeze({stored:false,reason:"PAYLOAD_TOO_LARGE",pause:true});
      const parkedAt=this.now();
      const record=Object.freeze({dispatchId:id,state:RECORD_STATE.PARKED,envelope:cleanEnvelope,parkedAt,expiresAt:parkedAt+this.ttlMs,claimedAt:null});
      candidate.set(id,record);
      if(!this._fitsAggregateBudget(candidate))return Object.freeze({stored:false,reason:"STORE_TOTAL_BYTES_EXCEEDED",pause:true});
      await this._commitCandidate(candidate);
      return Object.freeze({stored:true,reason:"PARKED",pause:false,record:clone(record)});
    });
  }

  async claim(dispatchId){
    return this._serialize(async()=>{
      const candidate=this._candidateWithPrunedParked();
      const id=String(dispatchId||"");const current=candidate.get(id);
      if(!current)return Object.freeze({claimed:false,reason:"NOT_FOUND",record:null});
      if(current.state===RECORD_STATE.CLAIMED)return Object.freeze({claimed:false,reason:"ALREADY_CLAIMED",record:clone(current)});
      const updated=Object.freeze({...current,state:RECORD_STATE.CLAIMED,claimedAt:this.now()});
      candidate.set(id,updated);this._assertAggregateBudget(candidate);
      await this._commitCandidate(candidate);
      return Object.freeze({claimed:true,reason:"CLAIMED",record:clone(updated)});
    });
  }

  async release(dispatchId){
    return this._serialize(async()=>{
      const id=String(dispatchId||"");const current=this.records.get(id);
      if(!current)return Object.freeze({released:false,reason:RELEASE_REASON.NOT_FOUND,pause:false,record:null});
      if(current.state!==RECORD_STATE.CLAIMED)return Object.freeze({released:false,reason:RELEASE_REASON.NOT_CLAIMED,pause:false,record:clone(current)});
      if(current.expiresAt<=this.now())return Object.freeze({released:false,reason:RELEASE_REASON.CLAIM_EXPIRED_RECONCILIATION_REQUIRED,pause:true,record:clone(current)});
      const updated=Object.freeze({...current,state:RECORD_STATE.PARKED,claimedAt:null});
      const candidate=new Map(this.records);candidate.set(id,updated);this._assertAggregateBudget(candidate);
      await this._commitCandidate(candidate);
      return Object.freeze({released:true,reason:RELEASE_REASON.RELEASED,pause:false,record:clone(updated)});
    });
  }

  async finalize(dispatchId){
    return this._serialize(async()=>{
      const id=String(dispatchId||"");
      if(!this.records.has(id))return false;
      const candidate=new Map(this.records);candidate.delete(id);
      await this._commitCandidate(candidate);
      return true;
    });
  }

  async drop(dispatchId){return this.finalize(dispatchId);}

  async get(dispatchId){
    return this._serialize(async()=>{
      const candidate=this._candidateWithPrunedParked();
      if(candidate.size!==this.records.size)await this._commitCandidate(candidate);
      return clone(this.records.get(String(dispatchId||""))||null);
    });
  }

  async size(){
    return this._serialize(async()=>{
      const candidate=this._candidateWithPrunedParked();
      if(candidate.size!==this.records.size)await this._commitCandidate(candidate);
      return this.records.size;
    });
  }

  async reconcileClaimed(dispatchId,ledger){
    return this._serialize(async()=>{
      if(!ledger||typeof ledger.get!=="function")return Object.freeze({action:RECONCILE.PAUSE,reason:"LEDGER_UNAVAILABLE"});
      const id=String(dispatchId||"");const record=this.records.get(id);
      if(!record)return Object.freeze({action:RECONCILE.NONE,reason:"NOT_FOUND"});
      if(record.state!==RECORD_STATE.CLAIMED)return Object.freeze({action:RECONCILE.NONE,reason:"NOT_CLAIMED"});
      const dispatch=ledger.get(id);
      if(dispatch&&TERMINAL_DISPATCH.has(dispatch.status)){
        const candidate=new Map(this.records);candidate.delete(id);
        await this._commitCandidate(candidate);
        return Object.freeze({action:RECONCILE.CLEARED,reason:dispatch.status});
      }
      return Object.freeze({action:RECONCILE.PAUSE,reason:dispatch?"CLAIM_OUTCOME_AMBIGUOUS":"DISPATCH_MISSING"});
    });
  }

  snapshot(){this._requireInit();return Object.freeze({records:[...this.records.values()].map(clone)});}

  _sanitizeRecord(raw){
    if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new TypeError("parked response record must be an object.");
    const dispatchId=text(raw.dispatchId,"dispatchId");const state=text(raw.state,"state").toUpperCase();
    if(!Object.values(RECORD_STATE).includes(state))throw new TypeError("parked response state is invalid.");
    const parkedAt=integer(raw.parkedAt,"parkedAt",0);const expiresAt=integer(raw.expiresAt,"expiresAt",0);if(expiresAt<parkedAt)throw new Error("expiresAt cannot precede parkedAt.");
    const claimedAt=raw.claimedAt==null?null:integer(raw.claimedAt,"claimedAt",0);
    if(state===RECORD_STATE.PARKED&&claimedAt!==null)throw new Error("PARKED response cannot have claimedAt.");
    if(state===RECORD_STATE.CLAIMED&&(claimedAt===null||claimedAt<parkedAt))throw new Error("CLAIMED response requires valid claimedAt.");
    const envelope=clone(raw.envelope??null);if(byteLength(envelope)>this.maxBytes)throw new Error("persisted parked response exceeds size limit.");
    return Object.freeze({dispatchId,state,envelope,parkedAt,expiresAt,claimedAt});
  }

  _candidateWithPrunedParked(){const candidate=new Map(this.records);this._pruneExpiredParked(candidate);return candidate;}
  _pruneExpiredParked(records){const now=this.now();let changed=false;for(const[id,record]of records){if(record.state===RECORD_STATE.PARKED&&record.expiresAt<=now){records.delete(id);changed=true;}}return changed;}
  _serializedPayload(records){return{records:[...records.values()].map(clone)};}
  _fitsAggregateBudget(records){return byteLength(this._serializedPayload(records))<=this.maxTotalBytes;}
  _assertAggregateBudget(records){if(records.size>this.maxEntries)throw new Error("Parked-response count exceeds maxEntries.");if(!this._fitsAggregateBudget(records))throw new Error("Persisted parked-response store exceeds maxTotalBytes.");}
  async _persistMap(records){this._assertAggregateBudget(records);await this.store.save(this.key,this._serializedPayload(records));}
  async _commitCandidate(candidate){
    try{await this._persistMap(candidate);}catch(error){
      if(error instanceof ParkedResponseStoreError)throw error;
      throw new ParkedResponseStoreError(STORE_ERROR_CODE.MUTATION_PERSIST_FAILED,"Failed to persist parked-response mutation.",error);
    }
    this.records=candidate;
  }
  _requireInit(){if(!this.initialized)throw new Error("ParkedResponseStore.init() must complete before use.");}
  _serialize(task,requireInitialized=true){const run=async()=>{if(requireInitialized)this._requireInit();return task();};const next=this._queue.catch(()=>undefined).then(run);this._queue=next.catch(()=>undefined);return next;}
}
module.exports={RECORD_STATE,RECONCILE,RELEASE_REASON,STORE_ERROR_CODE,ParkedResponseStoreError,ParkedResponseStore};

  });

  root.AIBridgeRuntimeCore=Object.freeze({
    identity:load("shared/conversation-identity-core.cjs"),
    authority:load("thread_rollover/conversation-authority.js"),
    ledger:load("thread_rollover/dispatch-ledger.js"),
    rollover:load("thread_rollover/rollover-coordinator.js"),
    responseGate:load("thread_rollover/incoming-response-gate.js"),
    parked:load("thread_rollover/parked-response-store.js")
  });
})(globalThis);
