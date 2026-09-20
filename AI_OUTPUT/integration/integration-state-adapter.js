import {PAUSE_REASON,pauseMeta,mapSubsystemReason,formatPauseReason,ACTION_CERTAINTY} from './pause-reasons.js';
import {summarizeProviderHealth} from './provider-health-reducer.js';

const DOM_CAPABILITY_REASON=Object.freeze({
  composer:PAUSE_REASON.DOM_COMPOSER_UNAVAILABLE,
  send:PAUSE_REASON.DOM_SEND_UNAVAILABLE,
  stop:PAUSE_REASON.DOM_STOP_UNAVAILABLE,
  upload:PAUSE_REASON.DOM_UPLOAD_UNAVAILABLE,
  new_chat:PAUSE_REASON.DOM_NEW_CHAT_UNAVAILABLE
});
export class IntegrationStateAdapter{
  pauseFromCode({code,side,provider,detail=null}={}){
    const meta=pauseMeta(code);
    return Object.freeze({running:false,pause:Object.freeze({code:meta.code,side:String(side||'?').toUpperCase(),provider:String(provider||'AI'),certainty:meta.certainty,message:meta.message,detail:detail==null?null:String(detail).slice(0,160)}),pauseReason:formatPauseReason({code:meta.code,side,provider})});
  }
  pauseFromSubsystem({reason,side,provider,detail=null}={}){
    const code=mapSubsystemReason(reason);
    if(!code)throw new Error('Unmapped subsystem pause reason: '+String(reason||''));
    return this.pauseFromCode({code,side,provider,detail});
  }
  pauseFromDomCapability({capability,authorityReason,side,provider}={}){
    const reason=String(authorityReason||'');
    const code=reason==='CONTRACT_DISAGREEMENT'?PAUSE_REASON.DOM_CONTRACT_DISAGREEMENT:DOM_CAPABILITY_REASON[String(capability||'')];
    if(!code)throw new Error('No pause taxonomy for required DOM capability: '+String(capability||''));
    return this.pauseFromCode({code,side,provider,detail:reason});
  }
  providerHealth(input){return summarizeProviderHealth(input);}
  actionCertaintyForReason(code){return pauseMeta(code).certainty;}
}
export {ACTION_CERTAINTY};
