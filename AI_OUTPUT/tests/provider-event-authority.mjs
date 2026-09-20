import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const content=fs.readFileSync(path.join(root,'runtime_review','content.js'),'utf8');
const background=fs.readFileSync(path.join(root,'runtime_review','background.js'),'utf8');

assert.ok(content.includes('authorityRegistrationId:registration?.authorityRegistrationId'),'content event must carry registration authority');
assert.ok(content.includes('generationEpoch:registration?.generationEpoch'),'content event must carry generation');
assert.ok(content.includes('conversationIdentity:registration?.identity'),'content event must carry canonical identity');

const start=background.indexOf('function reviewValidateProviderEventAuthority');
const end=background.indexOf('function normalizeProviderEventText',start);
assert.ok(start>=0 && end>start,'provider-event authority validator missing');
const block=background.slice(start,end);

for(const token of [
  'sender?.id!==chrome.runtime.id',
  'sender?.frameId!==0',
  'documentLifecycle',
  'sender?.documentId',
  'reviewAuthorityBySide.get(side)',
  'live.documentId',
  'live.authorityRegistrationId',
  'live.generationEpoch',
  'reviewSameIdentity(eventIdentity,live.identity)',
  'dispatch.generationEpoch',
  'reviewSameIdentity(dispatch.conversationIdentity,live.identity)'
]) assert.ok(block.includes(token),'authority validator missing '+token);

for(const reason of [
  'PROVIDER_EVENT_EXTENSION_ID_MISMATCH',
  'PROVIDER_EVENT_FRAME_MISMATCH',
  'PROVIDER_EVENT_DOCUMENT_NOT_ACTIVE',
  'PROVIDER_EVENT_DOCUMENT_ID_MISSING',
  'PROVIDER_EVENT_AUTHORITY_MISSING',
  'PROVIDER_EVENT_TAB_MISMATCH',
  'PROVIDER_EVENT_AUTHORITY_PROVIDER_MISMATCH',
  'PROVIDER_EVENT_DOCUMENT_MISMATCH',
  'PROVIDER_EVENT_REGISTRATION_MISMATCH',
  'PROVIDER_EVENT_GENERATION_MISMATCH',
  'PROVIDER_EVENT_IDENTITY_INVALID',
  'PROVIDER_EVENT_IDENTITY_MISMATCH',
  'PROVIDER_EVENT_DISPATCH_UNKNOWN',
  'PROVIDER_EVENT_DISPATCH_SIDE_MISMATCH',
  'PROVIDER_EVENT_DISPATCH_TAB_MISMATCH',
  'PROVIDER_EVENT_DISPATCH_GENERATION_MISMATCH',
  'PROVIDER_EVENT_DISPATCH_IDENTITY_MISMATCH'
]) assert.ok(block.includes(reason),'missing fail-closed reason '+reason);

const recordStart=background.indexOf('async function recordProviderEvent');
const recordEnd=background.indexOf('async function pauseBridge',recordStart);
const recordBlock=background.slice(recordStart,recordEnd);
assert.ok(recordBlock.indexOf('reviewValidateProviderEventAuthority') < recordBlock.indexOf('state.providerEvents.push(event)'),'event must be authorized before durable provider history mutation');
assert.ok(recordBlock.indexOf('reviewValidateProviderEventAuthority') < recordBlock.indexOf('recordTranscript("provider-event"'),'event must be authorized before transcript mutation');
assert.ok(recordBlock.indexOf('reviewValidateProviderEventAuthority') < recordBlock.indexOf('runtimePhase="PROVIDER_RECOVERY_REQUIRED"'),'event must be authorized before session pause');

console.log('provider-event-authority: PASS');
