import {PAUSE_REASON,pauseMeta,mapSubsystemReason,formatPauseReason,ACTION_CERTAINTY,isKnownPauseCode} from './pause-reasons.js';
import {summarizeProviderHealth} from './provider-health-reducer.js';

const DOM_CAPABILITY_REASON=Object.freeze({
  composer:PAUSE_REASON.DOM_COMPOSER_UNAVAILABLE,
  send:PAUSE_REASON.DOM_SEND_UNAVAILABLE,
  stop:PAUSE_REASON.DOM_STOP_UNAVAILABLE,
  upload:PAUSE_REASON.DOM_UPLOAD_UNAVAILABLE,
  new_chat:PAUSE_REASON.DOM_NEW_CHAT_UNAVAILABLE
});
function clean(value,max=160){return value==null?null:String(value).slice(0,max);}
export class IntegrationStateAdapter{
  pauseFromCode({code,side,provider,detail=null}={}){
    const original=String(code||'');
    const meta=pauseMeta(original);
    const effectiveCode=meta.code;
    return Object.freeze({running:false,paused:true,pause:Object.freeze({code:effectiveCode,side:String(side||'?').toUpperCase(),provider:String(provider||'AI'),certainty:meta.certainty,message:meta.message,detail:clean(detail),sourceCode:isKnownPauseCode(original)?null:clean(original,120)}),pauseReason:formatPauseReason({code:effectiveCode,side,provider})});
  }
  pauseFromSubsystem({reason,side,provider,detail=null}={}){
    const code=mapSubsystemReason(reason);
    if(!code)return this.pauseFromCode({code:PAUSE_REASON.RUNTIME_UNMAPPED_SAFETY_STATE,side,provider,detail:'Unmapped subsystem reason: '+String(reason||'')});
    return this.pauseFromCode({code,side,provider,detail});
  }
  pauseFromDomCapability({capability,authorityReason,side,provider}={}){
    const reason=String(authorityReason||'');
    const code=reason==='CONTRACT_DISAGREEMENT'?PAUSE_REASON.DOM_CONTRACT_DISAGREEMENT:DOM_CAPABILITY_REASON[String(capability||'')];
    if(!code)return this.pauseFromCode({code:PAUSE_REASON.RUNTIME_UNMAPPED_SAFETY_STATE,side,provider,detail:'No DOM pause taxonomy for capability '+String(capability||'')});
    return this.pauseFromCode({code,side,provider,detail:reason});
  }
  pauseFromReconnectFailure({side='ALL',provider='Runtime',detail=null}={}){return this.pauseFromCode({code:PAUSE_REASON.RUNTIME_RECONNECT_FAILED,side,provider,detail});}
  pauseFromRecoveryFailure({side='ALL',provider='Runtime',detail=null}={}){return this.pauseFromCode({code:PAUSE_REASON.RUNTIME_RECOVERY_FAILED,side,provider,detail});}
  providerHealth(input){return summarizeProviderHealth(input);}
  actionCertaintyForReason(code){return pauseMeta(code).certainty;}
}
export {ACTION_CERTAINTY};
