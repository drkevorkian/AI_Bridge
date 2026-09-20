import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const content=fs.readFileSync(path.join(root,'runtime_review','content.js'),'utf8');
const background=fs.readFileSync(path.join(root,'runtime_review','background.js'),'utf8');

assert.ok(content.includes('authorityRegistrationId:registration.authorityRegistrationId'));
assert.ok(content.includes('!node.closest("[data-message-author-role=\'assistant\'],[data-message-author-role=\\\"assistant\\\"]")'));

const start=background.indexOf('function reviewAuthorizeProviderEvent');
const end=background.indexOf('chrome.runtime.onMessage.addListener',start);
assert.ok(start>=0 && end>start,'provider event authority helper missing');
const auth=background.slice(start,end);

for(const token of [
  'sender?.id !== chrome.runtime.id',
  'sender.frameId !== 0',
  'sender.documentLifecycle',
  'sender.documentId',
  'reviewAuthorityBySide.get(side)',
  'dispatch.side !== side',
  'authority.side !== side',
  'dispatch.tabId',
  'authority.tabId',
  'reviewProviderFromUrl(sender.url || sender.tab?.url)',
  'authority.provider',
  'authority.documentId',
  'authorityRegistrationId',
  'authority.generationEpoch',
  'dispatch.generationEpoch',
  'reviewSanitizeIdentity(msg?.conversationIdentity)',
  'reviewSameIdentity(identity, authority.identity)',
  'reviewSameIdentity(identity, dispatch.conversationIdentity)'
]) assert.ok(auth.includes(token),'authority helper missing '+token);

for(const reason of [
  'PROVIDER_EVENT_EXTENSION_ID_MISMATCH',
  'PROVIDER_EVENT_TAB_MISMATCH',
  'PROVIDER_EVENT_DOCUMENT_NOT_ACTIVE',
  'PROVIDER_EVENT_DOCUMENT_ID_MISSING',
  'PROVIDER_EVENT_AUTHORITY_REJECTED',
  'PROVIDER_EVENT_TAB_SIDE_MISMATCH',
  'PROVIDER_EVENT_PROVIDER_MISMATCH',
  'PROVIDER_EVENT_DOCUMENT_MISMATCH',
  'PROVIDER_EVENT_REGISTRATION_MISMATCH',
  'PROVIDER_EVENT_GENERATION_MISMATCH',
  'PROVIDER_EVENT_IDENTITY_INVALID',
  'PROVIDER_EVENT_IDENTITY_MISMATCH'
]) assert.ok(auth.includes(reason),'missing fail-closed reason '+reason);

const handlerStart=background.indexOf('if (msg.type === "AI_BRIDGE_PROVIDER_EVENT")');
const handlerEnd=background.indexOf('if (msg.type === "AI_BRIDGE_THREAD_LIMIT")',handlerStart);
const handler=background.slice(handlerStart,handlerEnd);
assert.ok(handler.includes('recordProviderEvent(msg, sender)'),'message handler must delegate through the provider-event authority path');

const recordStart=background.indexOf('async function recordProviderEvent');
const recordEnd=background.indexOf('async function pauseBridge',recordStart);
assert.ok(recordStart>=0 && recordEnd>recordStart,'provider event recorder missing');
const record=background.slice(recordStart,recordEnd);
assert.ok(record.includes('reviewAuthorizeProviderEvent(msg,sender)'),'provider-event recorder must authorize the exact sender/document/dispatch before mutation');
assert.ok(record.indexOf('reviewAuthorizeProviderEvent(msg,sender)') < record.indexOf('state.running=false'),'authority validation must precede state mutation');
assert.ok(record.includes('if(!authorized.ok) return { ...authorized, ignored:true }'),'rejected provider events must fail closed without mutating session state');

console.log('round39-provider-event-authority: PASS');
