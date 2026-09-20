function requiredText(v,name,max=240){const s=String(v??'').trim();if(!s)throw new TypeError(name+' required.');return s.slice(0,max);}
function originAllowed(url,provider){let host;try{host=new URL(String(url||'')).hostname;}catch{return false;}const allowed={chatgpt:new Set(['chatgpt.com','chat.openai.com']),grok:new Set(['grok.com']),claude:new Set(['claude.ai']),gemini:new Set(['gemini.google.com']),copilot:new Set(['copilot.microsoft.com'])};return allowed[String(provider||'').toLowerCase()]?.has(host)||false;}
function sameIdentity(a,b){if(!a||!b)return a===b;return ['provider','threadKey','routeClass'].every(k=>String(a[k]??'')===String(b[k]??''));}
function equivalentAuthority(prior,{provider,tabId,documentId,observedIdentity}){return prior.provider===provider&&prior.tabId===tabId&&prior.documentId===documentId&&sameIdentity(prior.observedIdentity,observedIdentity);}
export const DOCUMENT_READINESS=Object.freeze({DISCONNECTED:'DISCONNECTED',LISTENER_CONNECTED:'LISTENER_CONNECTED',DOCUMENT_AUTHORITY_VERIFIED:'DOCUMENT_AUTHORITY_VERIFIED'});
export class DocumentAuthorityRegistry{
  constructor(){this.bySide=new Map();this.connectivity=new Map();}
  markListenerConnected(side,tabId){const s=requiredText(side,'side',16).toUpperCase();const t=Number(tabId);if(!Number.isInteger(t))throw new Error('LISTENER_INVALID_TAB');this.connectivity.set(s,Object.freeze({side:s,tabId:t,state:DOCUMENT_READINESS.LISTENER_CONNECTED}));return this.readiness(s);}
  register({sender,side,provider,generationEpoch,observedIdentity,expectedTabId,authorityRegistrationId}={}){
    if(!sender?.tab||!Number.isInteger(sender.tab.id))throw new Error('REGISTER_NO_TAB');
    if(Number.isInteger(expectedTabId)&&sender.tab.id!==expectedTabId)throw new Error('REGISTER_TAB_MISMATCH');
    if(sender.frameId!==0)throw new Error('REGISTER_SUBFRAME_REJECTED');
    if(String(sender.documentLifecycle||'').toLowerCase()!=='active')throw new Error('REGISTER_DOCUMENT_NOT_ACTIVE');
    const documentId=requiredText(sender.documentId,'documentId');
    const registrationId=requiredText(authorityRegistrationId,'authorityRegistrationId',160);
    const cleanSide=requiredText(side,'side',16).toUpperCase();const cleanProvider=requiredText(provider,'provider',40).toLowerCase();
    if(!originAllowed(sender.origin||sender.url||sender.tab.url,cleanProvider))throw new Error('REGISTER_PROVIDER_ORIGIN_MISMATCH');
    if(observedIdentity&&String(observedIdentity.provider||'').toLowerCase()!==cleanProvider)throw new Error('REGISTER_IDENTITY_PROVIDER_MISMATCH');
    const generation=Number(generationEpoch);if(!Number.isInteger(generation)||generation<0)throw new Error('REGISTER_INVALID_GENERATION');
    const normalizedIdentity=observedIdentity?Object.freeze({...observedIdentity}):null;
    const prior=this.bySide.get(cleanSide);
    if(prior&&generation<prior.generationEpoch)throw new Error('REGISTER_STALE_GENERATION');
    if(prior&&generation===prior.generationEpoch&&!equivalentAuthority(prior,{provider:cleanProvider,tabId:sender.tab.id,documentId,observedIdentity:normalizedIdentity}))throw new Error('REGISTER_GENERATION_AUTHORITY_CONFLICT');
    const record=Object.freeze({side:cleanSide,provider:cleanProvider,tabId:sender.tab.id,documentId,authorityRegistrationId:registrationId,frameId:0,lifecycle:'active',generationEpoch:generation,observedIdentity:normalizedIdentity,registeredAt:Date.now()});
    this.bySide.set(cleanSide,record);this.connectivity.set(cleanSide,Object.freeze({side:cleanSide,tabId:sender.tab.id,state:DOCUMENT_READINESS.DOCUMENT_AUTHORITY_VERIFIED}));return record;
  }
  get(side){return this.bySide.get(String(side||'').toUpperCase())||null;}
  readiness(side){const s=String(side||'').toUpperCase();const r=this.bySide.get(s);if(r)return Object.freeze({side:s,tabId:r.tabId,state:DOCUMENT_READINESS.DOCUMENT_AUTHORITY_VERIFIED,documentId:r.documentId,generationEpoch:r.generationEpoch,authorityRegistrationId:r.authorityRegistrationId});return this.connectivity.get(s)||Object.freeze({side:s,tabId:null,state:DOCUMENT_READINESS.DISCONNECTED});}
  invalidate(side){const s=String(side||'').toUpperCase();const removed=this.bySide.delete(s);const conn=this.connectivity.get(s);if(conn)this.connectivity.set(s,Object.freeze({...conn,state:DOCUMENT_READINESS.LISTENER_CONNECTED}));return removed;}
  clear(){this.bySide.clear();this.connectivity.clear();}
  buildMessageTarget(side){const r=this.get(side);if(!r)throw new Error('DOCUMENT_AUTHORITY_MISSING');if(r.lifecycle!=='active')throw new Error('DOCUMENT_AUTHORITY_NOT_ACTIVE');return Object.freeze({tabId:r.tabId,options:Object.freeze({documentId:r.documentId}),documentId:r.documentId,generationEpoch:r.generationEpoch,authorityRegistrationId:r.authorityRegistrationId,provider:r.provider,observedIdentity:r.observedIdentity});}
}
