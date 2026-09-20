import {DOCUMENT_READINESS} from './document-authority-registry.js';
function requiredText(v,name,max=240){const s=String(v??'').trim();if(!s)throw new TypeError(name+' required.');return s.slice(0,max);}
function normalizeIdentity(raw){if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;return Object.freeze({provider:String(raw.provider||'').toLowerCase(),threadKey:String(raw.threadKey||''),routeClass:String(raw.routeClass||'')});}
function sameIdentity(a,b){const x=normalizeIdentity(a),y=normalizeIdentity(b);return Boolean(x&&y)&&['provider','threadKey','routeClass'].every(k=>x[k]===y[k]);}
export const IDENTITY_POLICY=Object.freeze({EXACT:'EXACT',ROLLOVER_CANDIDATE:'ROLLOVER_CANDIDATE'});
function sanitizePolicy(policy,expectedIdentity,challengeProvider){
  const provider=requiredText(challengeProvider,'provider',40).toLowerCase();
  if(policy==null&&expectedIdentity){const expected=normalizeIdentity(expectedIdentity);if(!expected)throw new Error('REGISTER_EXPECTED_IDENTITY_REQUIRED');if(expected.provider!==provider)throw new Error('REGISTER_IDENTITY_PROVIDER_MISMATCH');return Object.freeze({mode:IDENTITY_POLICY.EXACT,expectedIdentity:expected});}
  if(!policy||typeof policy!=='object'||Array.isArray(policy))throw new Error('REGISTER_IDENTITY_POLICY_REQUIRED');
  const mode=String(policy.mode||'').toUpperCase();
  if(mode===IDENTITY_POLICY.EXACT){const expected=normalizeIdentity(policy.expectedIdentity??expectedIdentity);if(!expected)throw new Error('REGISTER_EXPECTED_IDENTITY_REQUIRED');if(expected.provider!==provider)throw new Error('REGISTER_IDENTITY_PROVIDER_MISMATCH');return Object.freeze({mode,expectedIdentity:expected});}
  if(mode===IDENTITY_POLICY.ROLLOVER_CANDIDATE){const policyProvider=String(policy.provider||expectedIdentity?.provider||provider).toLowerCase();if(policyProvider!==provider)throw new Error('REGISTER_IDENTITY_PROVIDER_MISMATCH');const oldThreadKey=String(policy.oldThreadKey??expectedIdentity?.threadKey??'');const allowed=[...(policy.allowedRouteClasses||[])].map(x=>String(x));if(!allowed.length)throw new Error('REGISTER_ROLLOVER_ROUTE_POLICY_REQUIRED');return Object.freeze({mode,provider,oldThreadKey,allowedRouteClasses:Object.freeze(allowed)});}
  throw new Error('REGISTER_IDENTITY_POLICY_INVALID');
}
export function identityAllowed(policy,currentIdentity){const current=normalizeIdentity(currentIdentity);if(!current)return false;if(policy.mode===IDENTITY_POLICY.EXACT)return sameIdentity(current,policy.expectedIdentity);if(policy.mode===IDENTITY_POLICY.ROLLOVER_CANDIDATE){if(current.provider!==policy.provider||!policy.allowedRouteClasses.includes(current.routeClass))return false;if(current.routeClass==='conversation'&&policy.oldThreadKey&&current.threadKey===policy.oldThreadKey)return false;return true;}return false;}
export const REGISTRATION_RESULT=Object.freeze({VERIFIED:'VERIFIED',REJECTED:'REJECTED',CHALLENGE_MISSING:'CHALLENGE_MISSING'});
export class DocumentRegistrationHandshake{
  constructor({registry,sendMessage,nonceFactory=()=>crypto.randomUUID(),registrationIdFactory=()=>crypto.randomUUID(),runtimeId=null}={}){
    if(!registry||typeof registry.register!=='function'||typeof registry.markListenerConnected!=='function')throw new TypeError('registry required.');
    if(typeof sendMessage!=='function'||typeof nonceFactory!=='function'||typeof registrationIdFactory!=='function')throw new TypeError('sendMessage, nonceFactory, and registrationIdFactory required.');
    this.registry=registry;this.sendMessage=sendMessage;this.nonceFactory=nonceFactory;this.registrationIdFactory=registrationIdFactory;this.runtimeId=runtimeId;this.challenges=new Map();
  }
  async establish({side,tabId,provider,generationEpoch,expectedIdentity,identityPolicy}={}){
    const s=requiredText(side,'side',16).toUpperCase();const t=Number(tabId);if(!Number.isInteger(t))throw new Error('REGISTER_INVALID_TAB');
    const cleanProvider=requiredText(provider,'provider',40).toLowerCase();const policy=sanitizePolicy(identityPolicy,expectedIdentity,cleanProvider);
    this.registry.markListenerConnected(s,t);
    const nonce=requiredText(this.nonceFactory(),'nonce',160);const authorityRegistrationId=requiredText(this.registrationIdFactory(),'authorityRegistrationId',160);
    this.challenges.set(s,Object.freeze({side:s,tabId:t,provider:cleanProvider,generationEpoch:Number(generationEpoch),identityPolicy:policy,nonce,authorityRegistrationId}));
    try{await this.sendMessage(t,{type:'AI_BRIDGE_REGISTER_DOCUMENT',nonce,authorityRegistrationId,side:s,provider:cleanProvider,generationEpoch,identityPolicy:policy});}
    catch(error){this.challenges.delete(s);return Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:'REGISTER_CHALLENGE_DELIVERY_FAILED',detail:String(error?.message||error).slice(0,160),readiness:this.registry.readiness(s)});}
    return Object.freeze({state:'CHALLENGE_SENT',nonce,authorityRegistrationId,readiness:this.registry.readiness(s)});
  }
  accept({message,sender}={}){
    const side=String(message?.side||'').toUpperCase();const challenge=this.challenges.get(side);
    if(!challenge)return Object.freeze({state:REGISTRATION_RESULT.CHALLENGE_MISSING,reason:'REGISTER_CHALLENGE_MISSING'});
    if(this.runtimeId&&sender?.id!==this.runtimeId)return Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:'REGISTER_EXTENSION_ID_MISMATCH'});
    if(String(message?.nonce||'')!==challenge.nonce)return Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:'REGISTER_NONCE_MISMATCH'});
    if(String(message?.authorityRegistrationId||'')!==challenge.authorityRegistrationId)return Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:'REGISTER_AUTHORITY_TOKEN_MISMATCH'});
    if(sender?.tab?.id!==challenge.tabId)return Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:'REGISTER_TAB_MISMATCH'});
    if(String(message?.provider||'').toLowerCase()!==challenge.provider)return Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:'REGISTER_PROVIDER_MISMATCH'});
    if(Number(message?.generationEpoch)!==challenge.generationEpoch)return Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:'REGISTER_GENERATION_MISMATCH'});
    const current=normalizeIdentity(message?.currentIdentity);if(!current||current.provider!==challenge.provider)return Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:'REGISTER_IDENTITY_PROVIDER_MISMATCH'});
    if(!identityAllowed(challenge.identityPolicy,current))return Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:'REGISTER_IDENTITY_MISMATCH'});
    let record;try{record=this.registry.register({sender,side,provider:challenge.provider,generationEpoch:challenge.generationEpoch,observedIdentity:current,expectedTabId:challenge.tabId,authorityRegistrationId:challenge.authorityRegistrationId});}catch(error){return Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:String(error?.message||error)});}
    this.challenges.delete(side);return Object.freeze({state:REGISTRATION_RESULT.VERIFIED,record,readiness:this.registry.readiness(side)});
  }
  invalidate(side){this.challenges.delete(String(side||'').toUpperCase());this.registry.invalidate(side);}
  readiness(side){return this.registry.readiness(side);}
}
export {DOCUMENT_READINESS};
