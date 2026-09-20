import {DOCUMENT_READINESS} from './document-authority-registry.js';
function requiredText(v,name,max=240){const s=String(v??'').trim();if(!s)throw new TypeError(name+' required.');return s.slice(0,max);}
export const REGISTRATION_RESULT=Object.freeze({VERIFIED:'VERIFIED',REJECTED:'REJECTED',CHALLENGE_MISSING:'CHALLENGE_MISSING'});
export class DocumentRegistrationHandshake{
  constructor({registry,sendMessage,nonceFactory=()=>crypto.randomUUID(),runtimeId=null}={}){
    if(!registry||typeof registry.register!=='function'||typeof registry.markListenerConnected!=='function')throw new TypeError('registry required.');
    if(typeof sendMessage!=='function'||typeof nonceFactory!=='function')throw new TypeError('sendMessage and nonceFactory required.');
    this.registry=registry;this.sendMessage=sendMessage;this.nonceFactory=nonceFactory;this.runtimeId=runtimeId;this.challenges=new Map();
  }
  async establish({side,tabId,provider,generationEpoch,expectedIdentity}={}){
    const s=requiredText(side,'side',16).toUpperCase();const t=Number(tabId);if(!Number.isInteger(t))throw new Error('REGISTER_INVALID_TAB');
    this.registry.markListenerConnected(s,t);
    const nonce=requiredText(this.nonceFactory(),'nonce',160);this.challenges.set(s,Object.freeze({side:s,tabId:t,provider:String(provider||'').toLowerCase(),generationEpoch:Number(generationEpoch),expectedIdentity:expectedIdentity?Object.freeze({...expectedIdentity}):null,nonce}));
    try{await this.sendMessage(t,{type:'AI_BRIDGE_REGISTER_DOCUMENT',nonce,side:s,provider,generationEpoch,expectedIdentity});}
    catch(error){this.challenges.delete(s);return Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:'REGISTER_CHALLENGE_DELIVERY_FAILED',detail:String(error?.message||error).slice(0,160),readiness:this.registry.readiness(s)});}
    return Object.freeze({state:'CHALLENGE_SENT',nonce,readiness:this.registry.readiness(s)});
  }
  accept({message,sender}={}){
    const side=String(message?.side||'').toUpperCase();const challenge=this.challenges.get(side);if(!challenge)return Object.freeze({state:REGISTRATION_RESULT.CHALLENGE_MISSING,reason:'REGISTER_CHALLENGE_MISSING'});
    if(this.runtimeId&&sender?.id&&sender.id!==this.runtimeId)return Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:'REGISTER_EXTENSION_ID_MISMATCH'});
    if(String(message?.nonce||'')!==challenge.nonce)return Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:'REGISTER_NONCE_MISMATCH'});
    if(sender?.tab?.id!==challenge.tabId)return Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:'REGISTER_TAB_MISMATCH'});
    if(String(message?.provider||'').toLowerCase()!==challenge.provider)return Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:'REGISTER_PROVIDER_MISMATCH'});
    if(Number(message?.generationEpoch)!==challenge.generationEpoch)return Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:'REGISTER_GENERATION_MISMATCH'});
    let record;try{record=this.registry.register({sender,side,provider:challenge.provider,generationEpoch:challenge.generationEpoch,observedIdentity:message?.currentIdentity??challenge.expectedIdentity,expectedTabId:challenge.tabId});}catch(error){return Object.freeze({state:REGISTRATION_RESULT.REJECTED,reason:String(error?.message||error)});}
    this.challenges.delete(side);return Object.freeze({state:REGISTRATION_RESULT.VERIFIED,record,readiness:this.registry.readiness(side)});
  }
  invalidate(side){this.challenges.delete(String(side||'').toUpperCase());this.registry.invalidate(side);}
  readiness(side){return this.registry.readiness(side);}
}
export {DOCUMENT_READINESS};
