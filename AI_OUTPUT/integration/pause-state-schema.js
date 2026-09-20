import {ACTION_CERTAINTY,PAUSE_REASON,pauseMeta,formatPauseReason,isKnownPauseCode} from './pause-reasons.js';
const VALID_CERTAINTY=new Set(Object.values(ACTION_CERTAINTY));
function bounded(v,max){return String(v??'').slice(0,max);}
export function defaultPauseState(){return Object.freeze({pause:null,pauseReason:''});}
export function sanitizePause(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const requested=bounded(raw.code,120);
  const meta=pauseMeta(requested);
  const certainty=VALID_CERTAINTY.has(raw.certainty)?raw.certainty:meta.certainty;
  return Object.freeze({
    code:meta.code,
    side:bounded(raw.side||'?',16).toUpperCase(),
    provider:bounded(raw.provider||'AI',80),
    certainty,
    message:bounded(raw.message||meta.message,500),
    detail:raw.detail==null?null:bounded(raw.detail,200),
    sourceCode:isKnownPauseCode(requested)?null:(raw.sourceCode==null?bounded(requested,120):bounded(raw.sourceCode,120))
  });
}
export function applyStructuredPause(state,pause){
  if(!state||typeof state!=='object')throw new TypeError('state object required.');
  const clean=sanitizePause(pause);
  if(!clean)throw new TypeError('valid structured pause required.');
  return {...state,running:false,paused:true,pause:clean,pauseReason:formatPauseReason({code:clean.code,side:clean.side,provider:clean.provider})};
}
export function clearStructuredPause(state){
  if(!state||typeof state!=='object')throw new TypeError('state object required.');
  return {...state,paused:false,pause:null,pauseReason:''};
}
export function migrateLegacyPauseState(state){
  if(!state||typeof state!=='object')throw new TypeError('state object required.');
  if(state.pause)return applyStructuredPause(state,state.pause);
  if(state.paused===true&&String(state.pauseReason||'').trim()){
    const pause={code:PAUSE_REASON.RUNTIME_RECOVERY_FAILED,side:'ALL',provider:'Runtime',certainty:ACTION_CERTAINTY.UNKNOWN,message:'AI Bridge restored a legacy pause without a machine-readable reason. Automatic resume is blocked until reviewed.',detail:bounded(state.pauseReason,200),sourceCode:'LEGACY_PAUSE_REASON'};
    return applyStructuredPause(state,pause);
  }
  return {...state,pause:null,pauseReason:String(state.pauseReason||'')};
}
