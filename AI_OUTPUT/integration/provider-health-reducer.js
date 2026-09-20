export const HEALTH_CONTEXT=Object.freeze({
  RELAY:'RELAY',
  ROLLOVER:'ROLLOVER',
  ARTIFACT_RELAY:'ARTIFACT_RELAY',
  CANCEL_GENERATION:'CANCEL_GENERATION'
});
export const PROVIDER_STATUS=Object.freeze({
  DISCONNECTED:'DISCONNECTED',
  REGISTERING:'REGISTERING',
  HEALTHY:'HEALTHY',
  DEGRADED:'DEGRADED',
  LIMITED:'LIMITED',
  BROKEN:'BROKEN',
  UNKNOWN:'UNKNOWN'
});
export const AUTHORITY_STATUS=Object.freeze({
  UNSPECIFIED:'UNSPECIFIED',
  DISCONNECTED:'DISCONNECTED',
  LISTENER_CONNECTED:'LISTENER_CONNECTED',
  REGISTERING:'REGISTERING',
  VERIFIED:'DOCUMENT_AUTHORITY_VERIFIED',
  UNKNOWN:'UNKNOWN'
});
const REQUIRED=Object.freeze({
  RELAY:Object.freeze(['composer','send','response','conversation_identity']),
  ROLLOVER:Object.freeze(['limit_state','new_chat','composer','send','response','conversation_identity']),
  ARTIFACT_RELAY:Object.freeze(['upload','composer','send','response','conversation_identity']),
  CANCEL_GENERATION:Object.freeze(['stop','conversation_identity'])
});
function stateOf(caps,name){return String(caps?.[name]?.state||'UNKNOWN').toUpperCase();}
function normalizeAuthority(readiness){
  if(readiness==null)return AUTHORITY_STATUS.UNSPECIFIED;
  const raw=typeof readiness==='string'?readiness:readiness?.state;
  const state=String(raw||'UNKNOWN').toUpperCase();
  return Object.values(AUTHORITY_STATUS).includes(state)?state:AUTHORITY_STATUS.UNKNOWN;
}
export function requiredCapabilities(context){
  const c=String(context||'').toUpperCase();
  if(!REQUIRED[c]) throw new TypeError('Unsupported health context: '+c);
  return REQUIRED[c];
}
export function summarizeProviderHealth({provider,bridgeConnected,documentReadiness,capabilities,context}={}){
  const required=requiredCapabilities(context);
  const cleanProvider=String(provider||'unknown').toLowerCase();
  const connectionStatus=bridgeConnected===true?'CONNECTED':'DISCONNECTED';
  const actionAuthorityStatus=normalizeAuthority(documentReadiness);
  const base={provider:cleanProvider,context:String(context),connectionStatus,actionAuthorityStatus,required};
  if(bridgeConnected!==true)return Object.freeze({...base,status:PROVIDER_STATUS.DISCONNECTED,runnable:false,blocking:Object.freeze([{capability:'bridge',state:'DISCONNECTED'}]),optionalIssues:Object.freeze([])});
  if(actionAuthorityStatus===AUTHORITY_STATUS.REGISTERING)return Object.freeze({...base,status:PROVIDER_STATUS.REGISTERING,runnable:false,blocking:Object.freeze([{capability:'document_authority',state:'REGISTERING'}]),optionalIssues:Object.freeze([])});
  if(actionAuthorityStatus!==AUTHORITY_STATUS.VERIFIED)return Object.freeze({...base,status:PROVIDER_STATUS.DEGRADED,runnable:false,blocking:Object.freeze([{capability:'document_authority',state:actionAuthorityStatus}]),optionalIssues:Object.freeze([])});
  const blocking=[],optionalIssues=[];
  for(const name of required){const state=stateOf(capabilities,name);if(state!=='PASS')blocking.push({capability:name,state});}
  for(const [name,value] of Object.entries(capabilities||{})){if(required.includes(name))continue;const state=String(value?.state||'UNKNOWN').toUpperCase();if(state!=='PASS')optionalIssues.push({capability:name,state});}
  let status=PROVIDER_STATUS.HEALTHY,runnable=true;
  if(blocking.some(x=>x.state==='FAIL')){status=PROVIDER_STATUS.BROKEN;runnable=false;}
  else if(blocking.some(x=>x.state==='UNSUPPORTED')){status=PROVIDER_STATUS.LIMITED;runnable=false;}
  else if(blocking.length){status=PROVIDER_STATUS.DEGRADED;runnable=false;}
  else if(optionalIssues.length)status=PROVIDER_STATUS.DEGRADED;
  return Object.freeze({...base,status,runnable,blocking:Object.freeze(blocking),optionalIssues:Object.freeze(optionalIssues)});
}
