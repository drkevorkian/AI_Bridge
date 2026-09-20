import identityCore from '../shared/conversation-identity-core.cjs';
import {DOCUMENT_READINESS} from './document-authority-registry.js';
const {sanitizeIdentity,sameIdentity}=identityCore;
function requiredText(v,name,max=240){const s=String(v??'').trim();if(!s)throw new TypeError(name+' required.');return s.slice(0,max);}
export const IDENTITY_POLICY=Object.freeze({EXACT:'EXACT',ROLLOVER_CANDIDATE:'ROLLOVER_CANDIDATE'});
function sanitizePolicy(policy,expectedIdentity,challengeProvider){
  const provider=requiredText(challengeProvider,'provider',40).toLowerCase();
  if(policy==null&&expectedIdentity){const expected=sanitizeIdentity(expectedIdentity);if(expected.provider!==provider)throw new Error('REGISTER_IDENTITY_PROVIDER_MISMATCH');return Object.freeze({mode:IDENTITY_POLICY.EXACT,expectedIdentity:expected});}
  if(!policy||typeof policy!=='object'||Array.isArray(policy))throw new Error('REGISTER_IDENTITY_POLICY_REQUIRED');
  const mode=String(policy.mode||'').toUpperCase();
  if(mode===IDENTITY_POLICY.EXACT){const expected=sanitizeIdentity(policy.expectedIdentity??expectedIdentity);if(expected.provider!==provider)throw new Error('REGISTER_IDENTITY_PROVIDER_MISMATCH');return Object.freeze({mode,expectedIdentity:expected});}
  if(mode===IDENTITY_POLICY.ROLLOVER_CANDIDATE){const policyProvider=String(policy.provider||expectedIdentity?.provider||provider).toLowerCase();if(policyProvider!==provider)throw new Error('REGISTER_IDENTITY_PROVIDER_MISMATCH');const oldThreadKey=String(policy.oldThreadKey??expectedIdentity?.threadKey??'');const allowedKinds=[...(policy.allowedKinds||['surface','conversation'])].map(String);const allowedRouteClasses=[...(policy.allowedRouteClasses||[])].map(String);if(!allowedRouteClasses.length)throw new Error('REGISTER_ROLLOVER_ROUTE_POLICY_REQUIRED');return Object.freeze({mode,provider,oldThreadKey,allowedKinds:Object.freeze(allowedKinds),allowedRouteClasses:Object.freeze(allowedRouteClasses)});}
  throw new Error('REGISTER_IDENTITY_POLICY_INVALID');
}
export function identityAllowed(policy,currentIdentity){let current;try{current=sanitizeIdentity(currentIdentity);}catch{return false;}if(policy.mode===IDENTITY_POLICY.EXACT)return sameIdentity(current,policy.expectedIdentity);if(policy.mode===IDENTITY_POLICY.ROLLOVER_CANDIDATE){if(current.provider!==policy.provider||!current.writable||!policy.allowedKinds.includes(current.kind)||!policy.allowedRouteClasses.includes(current.routeClass))return false;if(current.kind==='conversation'&&policy.oldThreadKey&&current.threadKey===policy.oldThreadKey)return false;return true;}return false;}
export const REGISTRATION_RESULT=Object.freeze({VERIFIED:'VERIFIED',REJECTED:'REJECTED',CHALLENGE_MISSING:'CHALLENGE_MISSING',TIMEOUT:'TIMEOUT'});
export class DocumentRegistrationHandshake{
  constructor({registry,sendMessage,nonceFactory=()=>crypto.randomUUID(),registrationIdFactory=()=>crypto.randomUUID(),runtimeId=null,challengeTtlMs=5000,now=()=>Date.now(),setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id),onFailure=()=>{}}={}){
    if(!registry||typeof registry.register!=='function'||typeof registry.suspendForRegistration!=='function')throw new TypeError('registry required.');
    if(typeof sendMessage!=='function'||typeof nonceFactory!=='function'||typeof registrationIdFactory!=='function'||typeof now!=='function'||typeof setTimer!=='function'||typeof clearTimer!=='function'||typeof onFailure!=='function')throw new TypeError('handshake dependencies required.');
    this.registry=registry;this.sendMessage=sendMessage;this.nonceFactory=nonceFactory;this.registrationIdFactory=registrationIdFactory;this.runtimeId=runtimeId;this.challengeTtlMs=Math.max(250,Math.min(60000,Number(challengeTtlMs)||5000));this.now=now;this.setTimer=setTimer;this.clearTimer=clearTimer;this.onFailure=onFailure;this.challenges=new Map();this.timers=new Map();
  }
  _clearTimer(side){const id=this.timers.get(side);if(id!=null){this.clearTimer(id);this.timers.delete(side);}}
  _expireSide(side,nonce,nowValue=this.now()){const challenge=this.challenges.get(side);if(!challenge||challenge.nonce!==nonce||nowValue<challenge.expiresAt)return null;this.challenges.delete(side);this._clearTimer(side);const readiness=this.registry.failRegistration(side);const result=Object.freeze({state:REGISTRATION_RESULT.TIMEOUT,reason:'DOCUMENT_REGISTRATION_TIMEOUT',side,provider:challenge.provider,readiness});this.onFailure(result);return result;}
  expirePending(nowValue=this.now()){const out=[];for(const [side,c] of [...this.challenges]){const r=this._expireSide(side,c.nonce,nowValue);if(r)out.push(r);}return out;}
  async establish({side,tabId,provider,generationEpoch,expectedIdentity,identityPolicy}={}){
    const s=requiredText(side,'side',16).toUpperCase();const t=Number(tabId);if(!Number.isInteger(t))throw new Error('REGISTER_INVALID_TAB');const cleanProvider=requiredText(provider,'provider',40).toLowerCase();const policy=sanitizePolicy(identityPolicy,expectedIdentity,cleanProvider);
    this._clearTimer(s);this.challenges.delete(s);this.registry.suspendForRegistration(s,t);
    const nonce=requiredText(this.nonceFactory(),'nonce',160);const authorityRegistrationId=requiredText(this.registrationIdFactory(),'authorityRegistrationId',160);const createdAt=this.now();const expiresAt=createdAt+this.challengeTtlMs;
    const challenge=Object.freeze({side:s,tabId:t,provider:cleanProvider,generationEpoch:Number(generationEpoch),identityPolicy:policy,nonce,authorityRegistrationId,createdAt,expiresAt});this.challenges.set(s,challenge);
    const timer=this.setTimer(()=>this._expireSide(s,nonce),this.challengeTtlMs);this.timers.set(s,timer);
    try{await this.sendMessage(t,{type:'AI_BRIDGE_REGISTER_DOCUMENT',nonce,authorityRegistrationId,side:s,provider:cleanProvider,generationEpoch,identityPolicy:policy,expiresAt});}
    catch(error){this.challenges.delete(s);this._clearTimer(s);const readiness=this.registry.failRegistration(s);const result=Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:'REGISTER_CHALLENGE_DELIVERY_FAILED',detail:String(error?.message||error).slice(0,160),readiness});this.onFailure(result);return result;}
    return Object.freeze({state:'CHALLENGE_SENT',nonce,authorityRegistrationId,expiresAt,readiness:this.registry.readiness(s)});
  }
  accept({message,sender}={}){
    const side=String(message?.side||'').toUpperCase();const challenge=this.challenges.get(side);if(!challenge)return Object.freeze({state:REGISTRATION_RESULT.CHALLENGE_MISSING,reason:'REGISTER_CHALLENGE_MISSING'});
    if(this.now()>=challenge.expiresAt)return this._expireSide(side,challenge.nonce,this.now())||Object.freeze({state:REGISTRATION_RESULT.TIMEOUT,reason:'DOCUMENT_REGISTRATION_TIMEOUT'});
    if(this.runtimeId&&sender?.id!==this.runtimeId)return Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:'REGISTER_EXTENSION_ID_MISMATCH'});
    if(String(message?.nonce||'')!==challenge.nonce)return Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:'REGISTER_NONCE_MISMATCH'});
    if(String(message?.authorityRegistrationId||'')!==challenge.authorityRegistrationId)return Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:'REGISTER_AUTHORITY_TOKEN_MISMATCH'});
    if(sender?.tab?.id!==challenge.tabId)return Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:'REGISTER_TAB_MISMATCH'});
    if(String(message?.provider||'').toLowerCase()!==challenge.provider)return Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:'REGISTER_PROVIDER_MISMATCH'});
    if(Number(message?.generationEpoch)!==challenge.generationEpoch)return Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:'REGISTER_GENERATION_MISMATCH'});
    let current;try{current=sanitizeIdentity(message?.currentIdentity);}catch{return Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:'REGISTER_IDENTITY_INVALID'});}if(current.provider!==challenge.provider)return Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:'REGISTER_IDENTITY_PROVIDER_MISMATCH'});if(!identityAllowed(challenge.identityPolicy,current))return Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:'REGISTER_IDENTITY_MISMATCH'});
    let record;try{record=this.registry.register({sender,side,provider:challenge.provider,generationEpoch:challenge.generationEpoch,observedIdentity:current,expectedTabId:challenge.tabId,authorityRegistrationId:challenge.authorityRegistrationId});}catch(error){return Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:String(error?.message||error)});}
    this.challenges.delete(side);this._clearTimer(side);return Object.freeze({state:REGISTRATION_RESULT.VERIFIED,record,readiness:this.registry.readiness(side)});
  }
  invalidate(side){const s=String(side||'').toUpperCase();this.challenges.delete(s);this._clearTimer(s);this.registry.invalidate(s);}
  readiness(side){this.expirePending();return this.registry.readiness(side);}
}
export {DOCUMENT_READINESS};
