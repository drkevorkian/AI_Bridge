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

