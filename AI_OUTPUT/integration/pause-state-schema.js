import {PAUSE_REASON,pauseMeta,formatPauseReason,isKnownPauseCode} from './pause-reasons.js';
function bounded(v,max){return String(v??'').slice(0,max);}
export function defaultPauseState(){return Object.freeze({pause:null,pauseReason:''});}
export function sanitizePause(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const requested=bounded(raw.code,120);
  const meta=pauseMeta(requested);
  const preservedSource=raw.sourceCode==null?null:bounded(raw.sourceCode,120);
  const sourceCode=preservedSource||(isKnownPauseCode(requested)?null:bounded(requested,120));
  return Object.freeze({
    code:meta.code,
    side:bounded(raw.side||'?',16).toUpperCase(),
    provider:bounded(raw.provider||'AI',80),
    certainty:meta.certainty,
    message:meta.message,
    detail:raw.detail==null?null:bounded(raw.detail,200),
    sourceCode
  });
}
export function applyStructuredPause(state,pause){
  if(!state||typeof state!=='object')throw new TypeError('state object required.');
  const clean=sanitizePause(pause);if(!clean)throw new TypeError('valid structured pause required.');
  return {...state,running:false,paused:true,pause:clean,pauseReason:formatPauseReason({code:clean.code,side:clean.side,provider:clean.provider})};
}
export function clearStructuredPause(state){if(!state||typeof state!=='object')throw new TypeError('state object required.');return {...state,paused:false,pause:null,pauseReason:''};}
export function migrateLegacyPauseState(state){
  if(!state||typeof state!=='object')throw new TypeError('state object required.');
  if(state.pause)return applyStructuredPause(state,state.pause);
  if(state.paused===true&&String(state.pauseReason||'').trim()){
    return applyStructuredPause(state,{code:PAUSE_REASON.RUNTIME_RECOVERY_FAILED,side:'ALL',provider:'Runtime',detail:bounded(state.pauseReason,200),sourceCode:'LEGACY_PAUSE_REASON'});
  }
  return {...state,pause:null,pauseReason:String(state.pauseReason||'')};
}
