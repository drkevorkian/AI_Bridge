export const HEALTH_CONTEXT=Object.freeze({
  RELAY:'RELAY',
  ROLLOVER:'ROLLOVER',
  ARTIFACT_RELAY:'ARTIFACT_RELAY',
  CANCEL_GENERATION:'CANCEL_GENERATION'
});
export const PROVIDER_STATUS=Object.freeze({
  DISCONNECTED:'DISCONNECTED',
  HEALTHY:'HEALTHY',
  DEGRADED:'DEGRADED',
  LIMITED:'LIMITED',
  BROKEN:'BROKEN',
  UNKNOWN:'UNKNOWN'
});
const REQUIRED=Object.freeze({
  RELAY:Object.freeze(['composer','send','response','conversation_identity']),
  ROLLOVER:Object.freeze(['limit_state','new_chat','composer','send','response','conversation_identity']),
  ARTIFACT_RELAY:Object.freeze(['upload','composer','send','response','conversation_identity']),
  CANCEL_GENERATION:Object.freeze(['stop','conversation_identity'])
});
function stateOf(caps,name){return String(caps?.[name]?.state||'UNKNOWN').toUpperCase();}
export function requiredCapabilities(context){
  const c=String(context||'').toUpperCase();
  if(!REQUIRED[c]) throw new TypeError('Unsupported health context: '+c);
  return REQUIRED[c];
}
export function summarizeProviderHealth({provider,bridgeConnected,capabilities,context}={}){
  const required=requiredCapabilities(context);
  const cleanProvider=String(provider||'unknown').toLowerCase();
  if(bridgeConnected!==true)return Object.freeze({provider:cleanProvider,context:String(context),status:PROVIDER_STATUS.DISCONNECTED,runnable:false,required,blocking:Object.freeze([{capability:'bridge',state:'DISCONNECTED'}])});
  const blocking=[],optionalIssues=[];
  for(const name of required){const state=stateOf(capabilities,name);if(state!=='PASS')blocking.push({capability:name,state});}
  for(const [name,value] of Object.entries(capabilities||{})){if(required.includes(name))continue;const state=String(value?.state||'UNKNOWN').toUpperCase();if(state!=='PASS')optionalIssues.push({capability:name,state});}
  let status=PROVIDER_STATUS.HEALTHY,runnable=true;
  if(blocking.some(x=>x.state==='FAIL')){status=PROVIDER_STATUS.BROKEN;runnable=false;}
  else if(blocking.some(x=>x.state==='UNSUPPORTED')){status=PROVIDER_STATUS.LIMITED;runnable=false;}
  else if(blocking.length){status=PROVIDER_STATUS.DEGRADED;runnable=false;}
  else if(optionalIssues.length)status=PROVIDER_STATUS.DEGRADED;
  return Object.freeze({provider:cleanProvider,context:String(context),status,runnable,required,blocking:Object.freeze(blocking),optionalIssues:Object.freeze(optionalIssues)});
}
