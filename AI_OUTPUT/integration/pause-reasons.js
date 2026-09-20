export const PAUSE_REASON=Object.freeze({
 DOM_SEND_UNAVAILABLE:'DOM_SEND_UNAVAILABLE',DOM_NEW_CHAT_UNAVAILABLE:'DOM_NEW_CHAT_UNAVAILABLE',DOM_CONTRACT_DISAGREEMENT:'DOM_CONTRACT_DISAGREEMENT',ROLLOVER_STORE_FULL:'ROLLOVER_STORE_FULL',ROLLOVER_CLAIM_AMBIGUOUS:'ROLLOVER_CLAIM_AMBIGUOUS',ROLLOVER_LIMIT_DETECTOR_UNAVAILABLE:'ROLLOVER_LIMIT_DETECTOR_UNAVAILABLE',ROLLOVER_IDENTITY_UNVERIFIED:'ROLLOVER_IDENTITY_UNVERIFIED'
});
const TEXT=Object.freeze({
 DOM_SEND_UNAVAILABLE:'Send control could not be verified after the provider page changed. No message was sent.',
 DOM_NEW_CHAT_UNAVAILABLE:'New Chat control could not be verified. AI Bridge did not click an untrusted control.',
 DOM_CONTRACT_DISAGREEMENT:'Trusted DOM selectors disagree about the control. No action was taken.',
 ROLLOVER_STORE_FULL:'Rollover paused because pending response storage is full. Existing responses were preserved.',
 ROLLOVER_CLAIM_AMBIGUOUS:'The previous delivery outcome could not be proven after recovery. AI Bridge will not replay automatically.',
 ROLLOVER_LIMIT_DETECTOR_UNAVAILABLE:'Automatic rollover is unavailable because no verified thread-limit detector exists for this provider.',
 ROLLOVER_IDENTITY_UNVERIFIED:'Conversation identity could not be verified after rollover. No automatic continuation occurred.'
});
export function formatPauseReason({code,side='?',provider='AI'}={}){const c=PAUSE_REASON[code]||code;return 'AI '+String(side)+' / '+String(provider)+' — paused\n'+(TEXT[c]||'AI Bridge paused because a required safety condition could not be verified.');}
