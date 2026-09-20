function requiredText(v,name,max=240){const s=String(v??'').trim();if(!s)throw new TypeError(name+' required.');return s.slice(0,max);}
function originAllowed(url,provider){let host;try{host=new URL(String(url||'')).hostname;}catch{return false;}const allowed={chatgpt:new Set(['chatgpt.com','chat.openai.com']),grok:new Set(['grok.com']),claude:new Set(['claude.ai']),gemini:new Set(['gemini.google.com']),copilot:new Set(['copilot.microsoft.com'])};return allowed[String(provider||'').toLowerCase()]?.has(host)||false;}
export class DocumentAuthorityRegistry{
  constructor(){this.bySide=new Map();}
  register({sender,side,provider,generationEpoch,observedIdentity}={}){
    if(!sender?.tab||!Number.isInteger(sender.tab.id))throw new Error('REGISTER_NO_TAB');
    if(sender.frameId!==0)throw new Error('REGISTER_SUBFRAME_REJECTED');
    const documentId=requiredText(sender.documentId,'documentId');
    const cleanSide=requiredText(side,'side',16).toUpperCase();const cleanProvider=requiredText(provider,'provider',40).toLowerCase();
    if(!originAllowed(sender.url||sender.tab.url,cleanProvider))throw new Error('REGISTER_PROVIDER_ORIGIN_MISMATCH');
    const generation=Number(generationEpoch);if(!Number.isInteger(generation)||generation<0)throw new Error('REGISTER_INVALID_GENERATION');
    const record=Object.freeze({side:cleanSide,provider:cleanProvider,tabId:sender.tab.id,documentId,generationEpoch:generation,observedIdentity:observedIdentity?Object.freeze({...observedIdentity}):null});
    this.bySide.set(cleanSide,record);return record;
  }
  get(side){return this.bySide.get(String(side||'').toUpperCase())||null;}
  invalidate(side){return this.bySide.delete(String(side||'').toUpperCase());}
  buildMessageTarget(side){const r=this.get(side);if(!r)throw new Error('DOCUMENT_AUTHORITY_MISSING');return Object.freeze({tabId:r.tabId,options:Object.freeze({documentId:r.documentId}),documentId:r.documentId,generationEpoch:r.generationEpoch,provider:r.provider});}
}
