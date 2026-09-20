export const ACTION_CERTAINTY=Object.freeze({
  NO_ACTION_TAKEN:'NO_ACTION_TAKEN',
  ACTION_CONFIRMED:'ACTION_CONFIRMED',
  ACTION_OUTCOME_AMBIGUOUS:'ACTION_OUTCOME_AMBIGUOUS',
  UNKNOWN:'UNKNOWN'
});
export const PAUSE_REASON=Object.freeze({
  DOM_COMPOSER_UNAVAILABLE:'DOM_COMPOSER_UNAVAILABLE',
  DOM_SEND_UNAVAILABLE:'DOM_SEND_UNAVAILABLE',
  DOM_STOP_UNAVAILABLE:'DOM_STOP_UNAVAILABLE',
  DOM_UPLOAD_UNAVAILABLE:'DOM_UPLOAD_UNAVAILABLE',
  DOM_NEW_CHAT_UNAVAILABLE:'DOM_NEW_CHAT_UNAVAILABLE',
  DOM_CONTRACT_DISAGREEMENT:'DOM_CONTRACT_DISAGREEMENT',
  ROLLOVER_STORE_FULL:'ROLLOVER_STORE_FULL',
  ROLLOVER_STORE_CAPACITY_EXCEEDED:'ROLLOVER_STORE_CAPACITY_EXCEEDED',
  ROLLOVER_RESPONSE_TOO_LARGE:'ROLLOVER_RESPONSE_TOO_LARGE',
  ROLLOVER_LEDGER_UNAVAILABLE:'ROLLOVER_LEDGER_UNAVAILABLE',
  ROLLOVER_DISPATCH_UNVERIFIED:'ROLLOVER_DISPATCH_UNVERIFIED',
  ROLLOVER_CLAIM_AMBIGUOUS:'ROLLOVER_CLAIM_AMBIGUOUS',
  ROLLOVER_CLAIM_RECONCILIATION_REQUIRED:'ROLLOVER_CLAIM_RECONCILIATION_REQUIRED',
  ROLLOVER_LIMIT_DETECTOR_UNAVAILABLE:'ROLLOVER_LIMIT_DETECTOR_UNAVAILABLE',
  ROLLOVER_IDENTITY_UNVERIFIED:'ROLLOVER_IDENTITY_UNVERIFIED',
  RUNTIME_RECONNECT_FAILED:'RUNTIME_RECONNECT_FAILED',
  RUNTIME_RECOVERY_FAILED:'RUNTIME_RECOVERY_FAILED',
  RUNTIME_RECOVERY_LOAD_FAILED:'RUNTIME_RECOVERY_LOAD_FAILED',
  RUNTIME_RECOVERY_VALIDATION_FAILED:'RUNTIME_RECOVERY_VALIDATION_FAILED',
  RUNTIME_RECOVERY_PERSIST_FAILED:'RUNTIME_RECOVERY_PERSIST_FAILED',
  RUNTIME_UNMAPPED_SAFETY_STATE:'RUNTIME_UNMAPPED_SAFETY_STATE'
});
const META=Object.freeze({
  DOM_COMPOSER_UNAVAILABLE:{certainty:ACTION_CERTAINTY.NO_ACTION_TAKEN,message:'Prompt composer could not be verified after the provider page changed. No message was entered.'},
  DOM_SEND_UNAVAILABLE:{certainty:ACTION_CERTAINTY.NO_ACTION_TAKEN,message:'Send control could not be verified after the provider page changed. No message was sent.'},
  DOM_STOP_UNAVAILABLE:{certainty:ACTION_CERTAINTY.NO_ACTION_TAKEN,message:'Stop control could not be verified. AI Bridge did not attempt an untrusted stop action.'},
  DOM_UPLOAD_UNAVAILABLE:{certainty:ACTION_CERTAINTY.NO_ACTION_TAKEN,message:'Upload control could not be verified. No artifact was attached.'},
  DOM_NEW_CHAT_UNAVAILABLE:{certainty:ACTION_CERTAINTY.NO_ACTION_TAKEN,message:'New Chat control could not be verified. AI Bridge did not click an untrusted control.'},
  DOM_CONTRACT_DISAGREEMENT:{certainty:ACTION_CERTAINTY.NO_ACTION_TAKEN,message:'Trusted DOM selectors disagree about the control. No action was taken.'},
  ROLLOVER_STORE_FULL:{certainty:ACTION_CERTAINTY.NO_ACTION_TAKEN,message:'Pending response storage is full. Existing parked responses were preserved.'},
  ROLLOVER_STORE_CAPACITY_EXCEEDED:{certainty:ACTION_CERTAINTY.NO_ACTION_TAKEN,message:'Pending response storage reached its safe aggregate capacity. Existing parked responses were preserved.'},
  ROLLOVER_RESPONSE_TOO_LARGE:{certainty:ACTION_CERTAINTY.NO_ACTION_TAKEN,message:'The parked response exceeds the configured safe storage limit. Existing parked responses were preserved.'},
  ROLLOVER_LEDGER_UNAVAILABLE:{certainty:ACTION_CERTAINTY.ACTION_OUTCOME_AMBIGUOUS,message:'The dispatch ledger is unavailable, so AI Bridge cannot prove the previous delivery outcome. It will not replay automatically.'},
  ROLLOVER_DISPATCH_UNVERIFIED:{certainty:ACTION_CERTAINTY.ACTION_OUTCOME_AMBIGUOUS,message:'The dispatch record needed to verify the previous response is missing. AI Bridge will not replay automatically.'},
  ROLLOVER_CLAIM_AMBIGUOUS:{certainty:ACTION_CERTAINTY.ACTION_OUTCOME_AMBIGUOUS,message:'The previous delivery outcome could not be proven after recovery. AI Bridge will not replay automatically.'},
  ROLLOVER_CLAIM_RECONCILIATION_REQUIRED:{certainty:ACTION_CERTAINTY.ACTION_OUTCOME_AMBIGUOUS,message:'A claimed parked response expired before release and now requires ledger reconciliation. AI Bridge will not replay or discard it automatically.'},
  ROLLOVER_LIMIT_DETECTOR_UNAVAILABLE:{certainty:ACTION_CERTAINTY.NO_ACTION_TAKEN,message:'Automatic rollover is unavailable because no verified thread-limit detector exists for this provider.'},
  ROLLOVER_IDENTITY_UNVERIFIED:{certainty:ACTION_CERTAINTY.NO_ACTION_TAKEN,message:'Conversation identity could not be verified after rollover. No automatic continuation occurred.'},
  RUNTIME_RECONNECT_FAILED:{certainty:ACTION_CERTAINTY.NO_ACTION_TAKEN,message:'AI Bridge could not reconnect the active provider tabs after service-worker restart. Relay work was not resumed.'},
  RUNTIME_RECOVERY_FAILED:{certainty:ACTION_CERTAINTY.UNKNOWN,message:'AI Bridge could not safely restore required runtime recovery state. No automatic recovery action will continue.'},
  RUNTIME_RECOVERY_LOAD_FAILED:{certainty:ACTION_CERTAINTY.UNKNOWN,message:'AI Bridge could not load persisted rollover recovery state. No parked response was replayed automatically.'},
  RUNTIME_RECOVERY_VALIDATION_FAILED:{certainty:ACTION_CERTAINTY.UNKNOWN,message:'Persisted rollover recovery state failed validation. No parked response was replayed automatically.'},
  RUNTIME_RECOVERY_PERSIST_FAILED:{certainty:ACTION_CERTAINTY.UNKNOWN,message:'AI Bridge could not durably persist repaired rollover recovery state. Recovery remains blocked.'},
  RUNTIME_UNMAPPED_SAFETY_STATE:{certainty:ACTION_CERTAINTY.UNKNOWN,message:'AI Bridge encountered an unmapped safety state. Automatic action is blocked until the condition is reviewed.'}
});
export function isKnownPauseCode(code){return Object.prototype.hasOwnProperty.call(META,String(code||''));}
export function pauseMeta(code){const c=String(code||'');return Object.freeze({code:isKnownPauseCode(c)?c:PAUSE_REASON.RUNTIME_UNMAPPED_SAFETY_STATE,...(META[c]||META.RUNTIME_UNMAPPED_SAFETY_STATE)});}
export function mapSubsystemReason(reason){
  const r=String(reason||'');
  const map={
    STORE_FULL:PAUSE_REASON.ROLLOVER_STORE_FULL,
    STORE_TOTAL_BYTES_EXCEEDED:PAUSE_REASON.ROLLOVER_STORE_CAPACITY_EXCEEDED,
    PAYLOAD_TOO_LARGE:PAUSE_REASON.ROLLOVER_RESPONSE_TOO_LARGE,
    LEDGER_UNAVAILABLE:PAUSE_REASON.ROLLOVER_LEDGER_UNAVAILABLE,
    DISPATCH_MISSING:PAUSE_REASON.ROLLOVER_DISPATCH_UNVERIFIED,
    CLAIM_OUTCOME_AMBIGUOUS:PAUSE_REASON.ROLLOVER_CLAIM_AMBIGUOUS,
    CLAIM_EXPIRED_RECONCILIATION_REQUIRED:PAUSE_REASON.ROLLOVER_CLAIM_RECONCILIATION_REQUIRED,
    RECOVERY_LOAD_FAILED:PAUSE_REASON.RUNTIME_RECOVERY_LOAD_FAILED,
    RECOVERY_ENTRY_LIMIT_EXCEEDED:PAUSE_REASON.RUNTIME_RECOVERY_VALIDATION_FAILED,
    RECOVERY_TOTAL_BYTES_EXCEEDED:PAUSE_REASON.RUNTIME_RECOVERY_VALIDATION_FAILED,
    RECOVERY_DUPLICATE_DISPATCH:PAUSE_REASON.RUNTIME_RECOVERY_VALIDATION_FAILED,
    RECOVERY_SCHEMA_INVALID:PAUSE_REASON.RUNTIME_RECOVERY_VALIDATION_FAILED,
    RECOVERY_PERSIST_FAILED:PAUSE_REASON.RUNTIME_RECOVERY_PERSIST_FAILED,
    CONTRACT_DISAGREEMENT:PAUSE_REASON.DOM_CONTRACT_DISAGREEMENT
  };
  return map[r]||null;
}
export function formatPauseReason({code,side='?',provider='AI'}={}){const meta=pauseMeta(code);return 'AI '+String(side)+' / '+String(provider)+' — paused\n'+meta.message;}
