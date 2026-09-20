"use strict";
const{DISPATCH_STATUS}=require("./dispatch-ledger.js");
const{PHASE}=require("./rollover-coordinator.js");
const{sanitizeIdentity,validateResponseAuthority,sameIdentity}=require("./conversation-authority.js");
const DISPOSITION=Object.freeze({COMMIT:"COMMIT",DROP:"DROP",PARK:"PARK",PAUSE:"PAUSE"});
function result(disposition,reason){return Object.freeze({ok:disposition===DISPOSITION.COMMIT,disposition,reason});}
function validateIncomingResponse({ledger,coordinator,authority,senderTabId,side,dispatchId,generationEpoch,conversationIdentity,rolloverId=null}={}){
  if(!ledger||typeof ledger.get!=="function")return result(DISPOSITION.PAUSE,"LEDGER_UNAVAILABLE");
  const dispatch=ledger.get(dispatchId);if(!dispatch)return result(DISPOSITION.DROP,"UNKNOWN_DISPATCH");
  if(dispatch.status===DISPATCH_STATUS.DELIVERY_AMBIGUOUS)return result(DISPOSITION.PAUSE,"DELIVERY_AMBIGUOUS");
  if(dispatch.status!==DISPATCH_STATUS.AWAITING_RESPONSE)return result(DISPOSITION.DROP,"DISPATCH_NOT_AWAITING_RESPONSE");
  if(String(side||"").toUpperCase()!==dispatch.side)return result(DISPOSITION.DROP,"SIDE_MISMATCH");
  if(Number(senderTabId)!==dispatch.tabId)return result(DISPOSITION.DROP,"TAB_MISMATCH");
  if(Number(generationEpoch)!==dispatch.generationEpoch)return result(DISPOSITION.DROP,"GENERATION_MISMATCH");
  let observed;try{observed=sanitizeIdentity(conversationIdentity);}catch(_){return result(DISPOSITION.DROP,"MALFORMED_IDENTITY");}
  if(observed.provider!==dispatch.conversationIdentity.provider)return result(DISPOSITION.DROP,"PROVIDER_MISMATCH");
  if(!observed.writable)return result(DISPOSITION.DROP,"IDENTITY_NOT_WRITABLE");
  if(dispatch.purpose!=="CONTINUITY"){const auth=validateResponseAuthority({authority,senderTabId,side,generationEpoch,conversationIdentity:observed});return auth.ok?result(DISPOSITION.COMMIT,"AUTHORIZED"):result(DISPOSITION.DROP,auth.reason);}
  if(!coordinator||typeof coordinator.get!=="function")return result(DISPOSITION.PAUSE,"ROLLOVER_UNAVAILABLE");
  const tx=coordinator.get(side);if(!tx)return result(DISPOSITION.PAUSE,"ROLLOVER_REQUIRED");
  if(rolloverId!=null&&tx.rolloverId!==String(rolloverId))return result(DISPOSITION.DROP,"ROLLOVER_MISMATCH");
  if(tx.phase===PHASE.DELIVERY_AMBIGUOUS)return result(DISPOSITION.PAUSE,"DELIVERY_AMBIGUOUS");
  if(tx.continuityDispatchId&&tx.continuityDispatchId!==String(dispatchId))return result(DISPOSITION.DROP,"DISPATCH_MISMATCH");
  if(sameIdentity(observed,tx.oldAuthority?.identity))return result(DISPOSITION.DROP,"STALE_OLD_CONVERSATION");
  if(tx.phase!==PHASE.AWAITING_CONTINUITY_RESPONSE)return result(DISPOSITION.PARK,"ROLLOVER_NOT_READY");
  if(!tx.candidateAuthority)return result(DISPOSITION.PARK,"CANDIDATE_AUTHORITY_PENDING");
  if(!sameIdentity(observed,tx.candidateAuthority.identity))return result(DISPOSITION.DROP,"CANDIDATE_IDENTITY_MISMATCH");
  const auth=validateResponseAuthority({authority:tx.candidateAuthority,senderTabId,side,generationEpoch,conversationIdentity:observed});
  if(!auth.ok)return result(DISPOSITION.DROP,auth.reason);
  return result(DISPOSITION.COMMIT,"AUTHORIZED_CONTINUITY_RESPONSE");
}
module.exports={DISPOSITION,validateIncomingResponse};
