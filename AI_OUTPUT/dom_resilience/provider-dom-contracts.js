import {RANK} from './selector-ranking.js';
export const CAPABILITY_CLASS=Object.freeze({ACTION_AUTHORITY:'ACTION_AUTHORITY',STATE_PROBE:'STATE_PROBE',RESPONSE_DISCOVERY:'RESPONSE_DISCOVERY',IDENTITY_PROBE:'IDENTITY_PROBE'});
function capability(cls,contracts=[],extra={}){return Object.freeze({class:cls,contracts:Object.freeze(contracts.map(c=>Object.freeze({...c}))),...extra});}
const action=(contracts=[],extra={})=>capability(CAPABILITY_CLASS.ACTION_AUTHORITY,contracts,extra);
const state=(contracts=[],extra={})=>capability(CAPABILITY_CLASS.STATE_PROBE,contracts,extra);
const response=(contracts=[],extra={})=>capability(CAPABILITY_CLASS.RESPONSE_DISCOVERY,contracts,extra);
const identity=(extra={})=>capability(CAPABILITY_CLASS.IDENTITY_PROBE,[],extra);
const unsupportedAction=()=>action([], {supported:false});
const unsupportedState=()=>state([], {supported:false});
function common(extra){return Object.freeze({...extra,upload:extra.upload||unsupportedAction(),new_chat:extra.new_chat||unsupportedAction(),limit_state:extra.limit_state||unsupportedState(),conversation_identity:extra.conversation_identity||identity()});}
export const PROVIDER_CONTRACTS=Object.freeze({
 chatgpt:common({
  composer:action([{id:'chatgpt-composer-testid',selector:'#prompt-textarea',rank:RANK.EXACT_SEMANTIC},{id:'chatgpt-composer-contenteditable',selector:"div[contenteditable='true'][data-virtualkeyboard='true']",rank:RANK.STRUCTURAL},{id:'chatgpt-composer-broad',selector:"div[contenteditable='true']",rank:RANK.BROAD_GENERIC}]),
  send:action([{id:'chatgpt-send-testid',selector:"button[data-testid='send-button']",rank:RANK.EXACT_SEMANTIC,requiresEnabled:true},{id:'chatgpt-send-aria',selector:"button[aria-label='Send prompt']",rank:RANK.ACCESSIBLE_EXACT,requiresEnabled:true}]),
  stop:action([{id:'chatgpt-stop-testid',selector:"button[data-testid='stop-button']",rank:RANK.EXACT_SEMANTIC},{id:'chatgpt-stop-aria',selector:"button[aria-label='Stop generating']",rank:RANK.ACCESSIBLE_EXACT}]),
  response:response([{id:'chatgpt-assistant-role',selector:"[data-message-author-role='assistant'] .markdown",rank:RANK.EXACT_SEMANTIC},{id:'chatgpt-assistant-container',selector:"[data-message-author-role='assistant']",rank:RANK.ACCESSIBLE_EXACT}]),
  limit_state:state([], {supported:true}),new_chat:action([], {supported:false,discoveryTelemetry:Object.freeze(['button','a'])})
 }),
 grok:common({
  composer:action([{id:'grok-composer-ask',selector:"textarea[placeholder*='Ask']",rank:RANK.ACCESSIBLE_EXACT},{id:'grok-composer-editable',selector:"div[contenteditable='true'][aria-label*='Grok']",rank:RANK.ACCESSIBLE_EXACT},{id:'grok-composer-broad',selector:"textarea, div[contenteditable='true']",rank:RANK.BROAD_GENERIC}]),
  send:action([{id:'grok-send-aria',selector:"button[aria-label='Send message']",rank:RANK.ACCESSIBLE_EXACT,requiresEnabled:true},{id:'grok-send-submit',selector:"button[type='submit']",rank:RANK.STRUCTURAL,requiresEnabled:true}]),
  stop:action([{id:'grok-stop-aria',selector:"button[aria-label='Stop']",rank:RANK.ACCESSIBLE_EXACT}]),
  response:response([{id:'grok-message-testid',selector:"[data-testid='message-text']",rank:RANK.EXACT_SEMANTIC},{id:'grok-message-broad',selector:"article, div[class*='message']",rank:RANK.BROAD_GENERIC}])
 }),
 claude:common({
  composer:action([{id:'claude-composer-prosemirror',selector:".ProseMirror[contenteditable='true']",rank:RANK.STRUCTURAL}]),
  send:action([{id:'claude-send-aria',selector:"button[aria-label='Send Message']",rank:RANK.ACCESSIBLE_EXACT,requiresEnabled:true}]),
  stop:action([{id:'claude-stop-aria',selector:"button[aria-label='Stop Response']",rank:RANK.ACCESSIBLE_EXACT}]),
  response:response([{id:'claude-response-stream',selector:'div[data-is-streaming]',rank:RANK.STRUCTURAL}])
 }),
 gemini:common({
  composer:action([{id:'gemini-rich-textarea',selector:"rich-textarea div[contenteditable='true']",rank:RANK.EXACT_SEMANTIC}]),
  send:action([{id:'gemini-send-aria',selector:"button[aria-label='Send message']",rank:RANK.ACCESSIBLE_EXACT,requiresEnabled:true}]),
  stop:action([{id:'gemini-stop-aria',selector:"button[aria-label*='Stop']",rank:RANK.STRUCTURAL}]),
  response:response([{id:'gemini-response-message',selector:'message-content',rank:RANK.EXACT_SEMANTIC}])
 }),
 copilot:common({
  composer:action([{id:'copilot-searchbox',selector:'textarea#searchbox',rank:RANK.EXACT_SEMANTIC}]),
  send:action([{id:'copilot-send-aria',selector:"button[aria-label*='Submit']",rank:RANK.STRUCTURAL,requiresEnabled:true}]),
  stop:action([{id:'copilot-stop-aria',selector:"button[aria-label*='Stop']",rank:RANK.STRUCTURAL}]),
  response:response([{id:'copilot-message',selector:'cib-message',rank:RANK.EXACT_SEMANTIC}])
 })
});
export function getProviderContracts(provider){return PROVIDER_CONTRACTS[String(provider||'').toLowerCase()]||null;}
