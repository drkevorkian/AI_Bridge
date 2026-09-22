'use strict';

(function initProviderLimitSignatures(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.AIBridgeProviderLimitSignatures = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const PROVIDERS = Object.freeze(['chatgpt', 'grok', 'claude', 'gemini', 'copilot']);
  const AUTHORITATIVE_REGION_KINDS = new Set(['system-banner', 'composer-status', 'provider-notice']);
  const NON_AUTHORITATIVE_REGION_KINDS = new Set(['assistant-response', 'user-message', 'transcript']);
  const RULES = Object.freeze({
    chatgpt: Object.freeze({
      required: Object.freeze([/you(?:'|’)ve reached the maximum length for this conversation/i,/maximum length for this conversation/i]),
      corroborative: Object.freeze([/start(?:ing)? a new chat to continue/i,/start a new chat/i]),
      exclusions: Object.freeze([/limit of messages/i,/usage limit/i,/try again in\s+\d+/i,/upload limit/i,/network error/i,/something went wrong/i,/error in message stream/i])
    }),
    grok: Object.freeze({ required:Object.freeze([]),corroborative:Object.freeze([]),exclusions:Object.freeze([/rate limit/i,/usage limit/i,/network error/i,/something went wrong/i]) }),
    claude: Object.freeze({ required:Object.freeze([]),corroborative:Object.freeze([]),exclusions:Object.freeze([/usage limit/i,/rate limit/i,/resets? at/i,/compacted/i,/compaction/i]) }),
    gemini: Object.freeze({ required:Object.freeze([]),corroborative:Object.freeze([]),exclusions:Object.freeze([/usage limit/i,/rate limit/i,/try again later/i,/network error/i]) }),
    copilot: Object.freeze({ required:Object.freeze([]),corroborative:Object.freeze([]),exclusions:Object.freeze([/rate limit/i,/usage limit/i,/network error/i]) })
  });
  function normalizeProvider(value){const provider=String(value||'').trim().toLowerCase();return PROVIDERS.includes(provider)?provider:null;}
  function normalizeText(value){return String(value||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim().slice(0,4000);}
  function normalizeRegion(region){if(!region||typeof region!=='object')return null;return {kind:String(region.kind||'').trim().toLowerCase(),text:normalizeText(region.text),visible:region.visible!==false};}
  function matchesAny(patterns,text){return patterns.some(pattern=>pattern.test(text));}
  function classifyThreadLimit(observation){
    const provider=normalizeProvider(observation?.provider);
    if(!provider)return Object.freeze({provider:null,state:'UNKNOWN_PROVIDER',automaticRollover:false,reason:'Provider is not supported.'});
    const rules=RULES[provider];
    const regions=Array.isArray(observation?.regions)?observation.regions.map(normalizeRegion).filter(Boolean):[];
    const authoritative=regions.filter(region=>region.visible&&AUTHORITATIVE_REGION_KINDS.has(region.kind)&&region.text);
    const transcript=regions.filter(region=>region.visible&&NON_AUTHORITATIVE_REGION_KINDS.has(region.kind)&&region.text);
    const authoritativeText=authoritative.map(region=>region.text).join(' | ');
    const transcriptText=transcript.map(region=>region.text).join(' | ');
    const requiredInTranscript=rules.required.length>0&&matchesAny(rules.required,transcriptText);
    if(!authoritativeText)return Object.freeze({provider,state:requiredInTranscript?'UNTRUSTED_TEXT_ONLY':'NO_LIMIT_SIGNAL',automaticRollover:false,reason:requiredInTranscript?'Thread-limit language appeared only in non-authoritative transcript content.':'No authoritative provider limit signal was observed.'});
    if(matchesAny(rules.exclusions,authoritativeText))return Object.freeze({provider,state:'NON_THREAD_LIMIT',automaticRollover:false,reason:'Observed provider UI indicates quota, transport, upload, or another non-thread limit.'});
    if(rules.required.length===0)return Object.freeze({provider,state:'NO_LIMIT_SIGNAL',automaticRollover:false,reason:'No packaged '+provider+' hard-limit signature is trusted yet.'});
    const requiredMatched=matchesAny(rules.required,authoritativeText);
    if(!requiredMatched){
      const corroborationOnly=matchesAny(rules.corroborative,authoritativeText);
      return Object.freeze({provider,state:corroborationOnly?'CORROBORATION_ONLY':'NO_LIMIT_SIGNAL',automaticRollover:false,reason:corroborationOnly?'New-chat guidance without mandatory maximum-conversation-length evidence is insufficient.':'Authoritative provider UI did not match the required hard thread-limit evidence.'});
    }
    const corroborativeText=matchesAny(rules.corroborative,authoritativeText);
    const composerDisabled=observation?.composer?.present===true&&observation?.composer?.disabled===true;
    return Object.freeze({provider,state:'HARD_THREAD_LIMIT',automaticRollover:true,confidence:(corroborativeText||composerDisabled)?'HIGH':'AUTHORITATIVE_TEXT',evidence:Object.freeze({requiredMatched:true,corroborativeText,composerDisabled}),reason:(corroborativeText||composerDisabled)?'Mandatory thread-length evidence matched with corroboration.':'Mandatory thread-length evidence matched in an approved provider control region.'});
  }
  return Object.freeze({PROVIDERS,AUTHORITATIVE_REGION_KINDS,classifyThreadLimit});
});
