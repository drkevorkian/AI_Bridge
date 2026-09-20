'use strict';
class ThreadRolloverOrchestrator {
  constructor({coordinator,classifyLimit,classifyIdentityTransition}) {
    if(!coordinator||typeof coordinator.begin!=='function'||typeof coordinator.transition!=='function')throw new TypeError('A canonical rollover coordinator is required.');
    if(typeof classifyLimit!=='function')throw new TypeError('classifyLimit is required.');
    if(typeof classifyIdentityTransition!=='function')throw new TypeError('classifyIdentityTransition is required.');
    this.coordinator=coordinator;this.classifyLimit=classifyLimit;this.classifyIdentityTransition=classifyIdentityTransition;
  }
  beginAuto(input){
    const evidence=this.classifyLimit(input.limitObservation);
    if(evidence?.state!=='HARD_THREAD_LIMIT'||evidence?.automaticRollover!==true)throw new Error('Automatic rollover requires authoritative HARD_THREAD_LIMIT evidence.');
    return this.coordinator.begin({rolloverId:input.rolloverId,side:input.side,provider:input.provider,triggeringDispatchId:input.triggeringDispatchId,oldAuthority:input.oldAuthority,hardLimitEvidence:evidence,triggerMode:'AUTO',startedAt:input.startedAt});
  }
  beginManual(input){
    return this.coordinator.begin({rolloverId:input.rolloverId,side:input.side,provider:input.provider,triggeringDispatchId:input.triggeringDispatchId,oldAuthority:input.oldAuthority,hardLimitEvidence:null,triggerMode:'MANUAL',startedAt:input.startedAt});
  }
  classifyIdentityObservation(previousIdentity,currentIdentity){
    const transition=this.classifyIdentityTransition(previousIdentity,currentIdentity);
    return Object.freeze({transition,accepted:transition==='NEW_CHAT_SURFACE'||transition==='NEW_CONVERSATION_CONFIRMED'});
  }
  applyIdentityObservation({side,previousIdentity,currentIdentity,candidateAuthority,nextPhase,now}){
    const observation=this.classifyIdentityObservation(previousIdentity,currentIdentity);
    if(!observation.accepted)return Object.freeze({applied:false,...observation});
    const transaction=this.coordinator.transition(side,nextPhase,{candidateAuthority},now);
    return Object.freeze({applied:true,...observation,transaction});
  }
}
module.exports={ThreadRolloverOrchestrator};
