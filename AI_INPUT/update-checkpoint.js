(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports) module.exports=api;
  root.AIBridgeUpdateCheckpoint=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const UPDATE_PHASE=Object.freeze({
    DRAINING:"DRAINING",
    CHECKPOINTED:"CHECKPOINTED",
    APPLIED_NOT_RELOADED:"APPLIED_NOT_RELOADED",
    RELOADED_NOT_REBOUND:"RELOADED_NOT_REBOUND",
    READY_TO_RESUME:"READY_TO_RESUME",
    COMPLETE:"COMPLETE",
    FAILED:"FAILED",
    CANCELLED:"CANCELLED"
  });
  const TRANSITIONS=Object.freeze({
    DRAINING:new Set(["CHECKPOINTED","FAILED","CANCELLED"]),
    CHECKPOINTED:new Set(["APPLIED_NOT_RELOADED","RELOADED_NOT_REBOUND","FAILED","CANCELLED"]),
    APPLIED_NOT_RELOADED:new Set(["RELOADED_NOT_REBOUND","FAILED"]),
    RELOADED_NOT_REBOUND:new Set(["READY_TO_RESUME","FAILED"]),
    READY_TO_RESUME:new Set(["COMPLETE","FAILED"]),
    COMPLETE:new Set(),FAILED:new Set(),CANCELLED:new Set()
  });
  const BLOCKING_PHASES=new Set([
    UPDATE_PHASE.DRAINING,UPDATE_PHASE.CHECKPOINTED,UPDATE_PHASE.APPLIED_NOT_RELOADED,
    UPDATE_PHASE.RELOADED_NOT_REBOUND,UPDATE_PHASE.READY_TO_RESUME
  ]);
  function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
  function text(value,name){const out=String(value??"").trim();if(!out)throw new TypeError(name+" must be a non-empty string.");return out;}
  function freezeCheckpoint(value){return Object.freeze({...value,nextTurnPending:clone(value.nextTurnPending),bindings:clone(value.bindings)});}
  function classifyBoundary({ledgerRecords=[],parkedRecords=[],providerRecovery=null,threadRollover=null,nextTurnPending=null,sessionActive=false,running=false}={}){
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
    return Object.freeze({safe:true,code:"SAFE_BOUNDARY",hasNextTurn:Boolean(nextTurnPending)});
  }
  function createCheckpoint({checkpointId,targetVersion,targetBuild,currentVersion,currentBuild,sessionActive=false,resumeRequested=false,nextTurnPending=null,bindings=[],createdAt=Date.now()}={}){
    const when=Number(createdAt);if(!Number.isFinite(when)||when<0)throw new TypeError("createdAt must be finite.");
    return freezeCheckpoint({
      schema:1,checkpointId:text(checkpointId,"checkpointId"),phase:UPDATE_PHASE.DRAINING,
      targetVersion:text(targetVersion,"targetVersion"),targetBuild:text(targetBuild,"targetBuild"),
      currentVersion:text(currentVersion,"currentVersion"),currentBuild:text(currentBuild,"currentBuild"),
      sessionActive:Boolean(sessionActive),resumeRequested:Boolean(resumeRequested),
      nextTurnPending:clone(nextTurnPending),bindings:clone(bindings),
      reloadAttempts:0,createdAt:when,updatedAt:when,failureReason:""
    });
  }
  function transitionCheckpoint(raw,nextPhase,patch={},now=Date.now()){
    if(!raw||typeof raw!=="object")throw new TypeError("checkpoint is required.");
    const current=String(raw.phase||""),next=text(nextPhase,"nextPhase");
    if(!Object.values(UPDATE_PHASE).includes(current)||!Object.values(UPDATE_PHASE).includes(next))throw new TypeError("Unknown update phase.");
    if(!TRANSITIONS[current]?.has(next))throw new Error("Invalid update transition "+current+" -> "+next+".");
    const when=Number(now);if(!Number.isFinite(when)||when<Number(raw.updatedAt||0))throw new TypeError("updatedAt must be monotonic.");
    return freezeCheckpoint({...raw,...clone(patch),phase:next,updatedAt:when,failureReason:patch.failureReason==null?String(raw.failureReason||""):String(patch.failureReason)});
  }
  function reviseCheckpoint(raw,patch={},now=Date.now()){
    if(!raw||typeof raw!=="object")throw new TypeError("checkpoint is required.");
    const when=Number(now);if(!Number.isFinite(when)||when<Number(raw.updatedAt||0))throw new TypeError("updatedAt must be monotonic.");
    return freezeCheckpoint({...raw,...clone(patch),phase:raw.phase,updatedAt:when});
  }
  function blocksDispatch(checkpoint){return Boolean(checkpoint&&BLOCKING_PHASES.has(checkpoint.phase));}
  function buildMatches(checkpoint,{version,build}={}){
    return Boolean(checkpoint&&String(version||"")===String(checkpoint.targetVersion)&&String(build||"")===String(checkpoint.targetBuild));
  }
  return Object.freeze({UPDATE_PHASE,classifyBoundary,createCheckpoint,transitionCheckpoint,reviseCheckpoint,blocksDispatch,buildMatches});
});
