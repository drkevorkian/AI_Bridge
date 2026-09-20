'use strict';
const STATUS=Object.freeze({ACTIVE:'ACTIVE',DEGRADED:'DEGRADED',BYPASSED_FOR_GATE:'BYPASSED_FOR_GATE'});
function normalizeText(value){return String(value||'').replace(/\s+/g,' ').trim();}
function looksLikePromptEcho(text){
  const t=normalizeText(text).toLowerCase();if(!t)return true;
  const signatures=['you are ai ','your assigned job:','team roster:','team rules (all members):','primary objective from the human controller:','shared updates since your last handoff:'];
  const matches=signatures.filter(sig=>t.includes(sig)).length;
  const hasReviewLanguage=/\b(confirm|challenge|found|defect|agree|disagree|pass|fail|reviewed|tested)\b/.test(t);
  return matches>=4&&!hasReviewLanguage;
}
function isSubstantive(text,{minChars=80}={}){
  const t=normalizeText(text);if(t.length<minChars)return false;if(looksLikePromptEcho(t))return false;
  return /\b(confirm|challenge|found|defect|agree|disagree|pass|fail|reviewed|tested|implemented|fixed|commit)\b/i.test(t);
}
class AgentParticipationGuard{
  constructor({threshold=3}={}){if(!Number.isInteger(threshold)||threshold<2||threshold>20)throw new TypeError('threshold must be an integer between 2 and 20.');this.threshold=threshold;this.records=new Map();}
  record(agentId,responseText){
    const id=normalizeText(agentId).toUpperCase();if(!id)throw new TypeError('agentId is required.');
    const substantive=isSubstantive(responseText);const prior=this.records.get(id)||{misses:0,status:STATUS.ACTIVE};const misses=substantive?0:prior.misses+1;
    const status=misses>=this.threshold?STATUS.BYPASSED_FOR_GATE:misses>0?STATUS.DEGRADED:STATUS.ACTIVE;
    const record=Object.freeze({agentId:id,substantive,misses,status});this.records.set(id,record);return record;
  }
  canProceedWithout(agentId){return this.records.get(normalizeText(agentId).toUpperCase())?.status===STATUS.BYPASSED_FOR_GATE;}
  rootIntegrationReviewRequired(agentId){return this.canProceedWithout(agentId);}
}
module.exports={STATUS,looksLikePromptEcho,isSubstantive,AgentParticipationGuard};
