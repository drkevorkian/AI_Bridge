(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports) module.exports=api;
  root.AIBridgeUpdateCheckpoint=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const UPDATE_PHASE=Object.freeze({DRAINING:"DRAINING",CHECKPOINTED:"CHECKPOINTED",APPLYING:"APPLYING",RELOAD_REQUESTED:"RELOAD_REQUESTED",RESTORING:"RESTORING",COMPLETE:"COMPLETE",FAILED:"FAILED",CANCELLED:"CANCELLED"});
  const TRANSITIONS=Object.freeze({
    DRAINING:new Set(["CHECKPOINTED","FAILED","CANCELLED"]),
    CHECKPOINTED:new Set(["APPLYING","FAILED","CANCELLED"]),
    APPLYING:new Set(["RELOAD_REQUESTED","FAILED"]),
    RELOAD_REQUESTED:new Set(["RESTORING","FAILED"]),
    RESTORING:new Set(["COMPLETE","FAILED"]),
    COMPLETE:new Set(),FAILED:new Set(),CANCELLED:new Set()
  });
  const NONTERMINAL_DISPATCH=new Set(["CREATED","DISPATCHING","ACCEPTED","AWAITING_RESPONSE","DELIVERY_AMBIGUOUS"]);
  function text(value,name){const out=String(value??"").trim();if(!out)throw new TypeError(name+" must be a non-empty string.");return out;}
  function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
  function freezeCheckpoint(value){return Object.freeze({...value,nextTurnPending:clone(value.nextTurnPending)});}
  function classifySafeBoundary({ledgerRecords=[],parkedRecords=[],providerRecovery=null,threadRollover=null,nextTurnPending=null,sessionActive=false,running=false}={}){
    const ledger=Array.isArray(ledgerRecords)?ledgerRecords:[];
    const parked=Array.isArray(parkedRecords)?parkedRecords:[];
    const ambiguous=ledger.find(r=>r?.status==="DELIVERY_AMBIGUOUS");
    if(ambiguous)return Object.freeze({safe:false,code:"DELIVERY_AMBIGUOUS",dispatchId:String(ambiguous.dispatchId||"")});
    const transition=ledger.find(r=>["CREATED","DISPATCHING","ACCEPTED"].includes(r?.status));
    if(transition)return Object.freeze({safe:false,code:"DELIVERY_TRANSITION_ACTIVE",dispatchId:String(transition.dispatchId||"")});
    const awaiting=ledger.find(r=>r?.status==="AWAITING_RESPONSE");
    if(awaiting)return Object.freeze({safe:false,draining:true,code:"AWAITING_PROVIDER_RESPONSE",dispatchId:String(awaiting.dispatchId||"")});
    const claimed=parked.find(r=>r?.state==="CLAIMED");
    if(claimed)return Object.freeze({safe:false,code:"RESPONSE_COMMIT_IN_PROGRESS",dispatchId:String(claimed.dispatchId||"")});
    const parkedResponse=parked.find(r=>r?.state==="PARKED");
    if(parkedResponse)return Object.freeze({safe:false,code:"PARKED_RESPONSE_PENDING",dispatchId:String(parkedResponse.dispatchId||"")});
    if(providerRecovery?.active)return Object.freeze({safe:false,code:"PROVIDER_RECOVERY_ACTIVE"});
    if(threadRollover?.active)return Object.freeze({safe:false,code:"THREAD_ROLLOVER_ACTIVE"});
    if(nextTurnPending){
      const source=ledger.find(r=>String(r?.dispatchId||"")===String(nextTurnPending.sourceDispatchId||""));
      if(!source||source.status!=="RESPONSE_COMMITTED")return Object.freeze({safe:false,code:"NEXT_TURN_SOURCE_NOT_COMMITTED"});
    }
    if(sessionActive&&running&&!nextTurnPending)return Object.freeze({safe:false,code:"RUNNING_SESSION_HAS_NO_DURABLE_CONTINUATION"});
    const live=ledger.filter(r=>NONTERMINAL_DISPATCH.has(r?.status));
    if(live.length)return Object.freeze({safe:false,code:"NONTERMINAL_DISPATCH_PRESENT"});
    return Object.freeze({safe:true,code:"SAFE_BOUNDARY",hasNextTurn:Boolean(nextTurnPending)});
  }
  function createCheckpoint({checkpointId,targetVersion,targetBuild,currentVersion,currentBuild,sessionActive=false,resumeRequested=false,nextTurnPending=null,createdAt=Date.now()}={}){
    const when=Number(createdAt);if(!Number.isFinite(when)||when<0)throw new TypeError("createdAt must be finite.");
    return freezeCheckpoint({schema:1,checkpointId:text(checkpointId,"checkpointId"),phase:UPDATE_PHASE.DRAINING,targetVersion:text(targetVersion,"targetVersion"),targetBuild:text(targetBuild,"targetBuild"),currentVersion:text(currentVersion,"currentVersion"),currentBuild:text(currentBuild,"currentBuild"),sessionActive:Boolean(sessionActive),resumeRequested:Boolean(resumeRequested),nextTurnPending:clone(nextTurnPending),createdAt:when,updatedAt:when,failureReason:""});
  }
  function transitionCheckpoint(raw,nextPhase,patch={},now=Date.now()){
    if(!raw||typeof raw!=="object")throw new TypeError("checkpoint is required.");
    const current=String(raw.phase||""),next=text(nextPhase,"nextPhase");
    if(!Object.values(UPDATE_PHASE).includes(current)||!Object.values(UPDATE_PHASE).includes(next))throw new TypeError("Unknown update phase.");
    if(!TRANSITIONS[current]?.has(next))throw new Error("Invalid update transition "+current+" -> "+next+".");
    const when=Number(now);if(!Number.isFinite(when)||when<Number(raw.updatedAt||0))throw new TypeError("updatedAt must be monotonic.");
    return freezeCheckpoint({...raw,...clone(patch),phase:next,updatedAt:when,failureReason:patch.failureReason==null?String(raw.failureReason||""):String(patch.failureReason)});
  }
  function isDispatchBlocked(checkpoint){return Boolean(checkpoint&&[UPDATE_PHASE.DRAINING,UPDATE_PHASE.CHECKPOINTED,UPDATE_PHASE.APPLYING,UPDATE_PHASE.RELOAD_REQUESTED,UPDATE_PHASE.RESTORING].includes(checkpoint.phase));}
  function verifyReloadTarget(checkpoint,{version,build}={}){
    if(!checkpoint||checkpoint.phase!==UPDATE_PHASE.RELOAD_REQUESTED)return Object.freeze({ok:false,reason:"CHECKPOINT_NOT_RELOAD_REQUESTED"});
    if(String(version||"")!==String(checkpoint.targetVersion))return Object.freeze({ok:false,reason:"VERSION_MISMATCH"});
    if(String(build||"")!==String(checkpoint.targetBuild))return Object.freeze({ok:false,reason:"BUILD_MISMATCH"});
    return Object.freeze({ok:true,reason:"TARGET_CONFIRMED"});
  }
  return Object.freeze({UPDATE_PHASE,classifySafeBoundary,createCheckpoint,transitionCheckpoint,isDispatchBlocked,verifyReloadTarget});
});
