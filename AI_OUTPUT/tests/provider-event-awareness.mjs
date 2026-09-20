import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const content=fs.readFileSync(path.join(root,'runtime_review','content.js'),'utf8');
const background=fs.readFileSync(path.join(root,'runtime_review','background.js'),'utf8');
const dashboard=fs.readFileSync(path.join(root,'runtime_review','dashboard.js'),'utf8');

for(const token of [
  'MESSAGE_DELIVERY_TIMEOUT',
  'message delivery timed out',
  'AI_BRIDGE_PROVIDER_EVENT',
  'operationalEventTexts()',
  'inspectProviderEvent()',
  'closest("[data-message-author-role=\'assistant\'],[data-message-author-role=\\"assistant\\"]")'
]) assert.ok(content.includes(token),'content missing '+token);

assert.ok(background.includes('state.running=false;'),'provider event must stop relay progression');
assert.ok(background.includes('state.paused=true;'),'provider event must pause the session');
assert.ok(background.includes('state.runtimePhase="PROVIDER_RECOVERY_REQUIRED"'),'provider event must enter recovery-required state');
assert.ok(background.includes('AI Bridge did not resend the prompt automatically; provider recovery is required.'),'provider event must explicitly forbid automatic resend');
assert.ok(background.includes('WAITING_SAME_DISPATCH'),'Resume must wait on the original dispatch instead of resending');
assert.ok(background.includes('PROVIDER_RESPONSE_RECOVERED'),'late provider response must be committed without auto-advancing');
assert.doesNotMatch(background,/PROVIDER_EVENT_"?\+?code[\s\S]{0,240}DELIVERY_AMBIGUOUS/,'provider event must not destroy response-capable dispatch state');
assert.ok(background.includes('recordTranscript("provider-event"'),'provider event must be visible without becoming an AI response');
assert.ok(background.includes('providerRecovery'),'provider recovery state missing');
assert.ok(background.includes('entry?.type !== "provider-event"'),'provider events must stay out of AI-to-AI relay context');
assert.ok(background.includes('MAX_PROVIDER_EVENTS'),'provider event history must be bounded');
assert.ok(dashboard.includes('entry.type === "provider-event"'),'dashboard provider-event rendering missing');
assert.ok(dashboard.includes('Provider event · AI'),'provider event title missing');
assert.ok(dashboard.includes('e.type === "provider-event"'),'provider events must be included in transcript rendering');
assert.ok(dashboard.includes('PROVIDER_RECOVERY_REQUIRED: "Provider recovery required"'),'provider recovery phase label missing');
assert.ok(dashboard.includes('PROVIDER_RESPONSE_RECOVERED: "Provider response recovered"'),'provider recovered phase label missing');

console.log('provider-event-awareness: PASS');


const backgroundPolicyDeclarations=background.split('const PROVIDER_EVENT_POLICY = Object.freeze(').length-1;
assert.equal(backgroundPolicyDeclarations,1,'exactly one provider event policy is allowed');

const contentClassifierDeclarations=content.split('function classifyProviderEvent(').length-1;
assert.equal(contentClassifierDeclarations,1,'exactly one provider event classifier is allowed');
assert.doesNotMatch(content,/function normalizeNoticeText\(/,'obsolete provider-event classifier helper must be removed');
assert.doesNotMatch(content,/inspectProviderEvents\(/,'obsolete plural provider-event detector must be removed');

const authorizeIndex=background.indexOf('const authorized=reviewAuthorizeProviderEvent(msg,sender)');
const providerMutationIndex=background.indexOf('state.providerEvents.push(event)',authorizeIndex);
assert.ok(authorizeIndex>=0 && providerMutationIndex>authorizeIndex,'provider event authority must be checked before durable mutation');

for(const token of [
  'PROVIDER_EVENT_EXTENSION_ID_MISMATCH',
  'PROVIDER_EVENT_DOCUMENT_NOT_ACTIVE',
  'PROVIDER_EVENT_DOCUMENT_ID_MISSING',
  'PROVIDER_EVENT_REGISTRATION_MISMATCH',
  'PROVIDER_EVENT_GENERATION_MISMATCH',
  'PROVIDER_EVENT_IDENTITY_MISMATCH'
]) assert.ok(background.includes(token),'provider authority rejection missing '+token);

assert.doesNotMatch(background,/"provider_event"/,'obsolete provider_event transcript spelling must not survive; provider operational events must remain excluded from every relay/recovery context');
const normalTurnStart=background.indexOf('function normalTurnMessage');
const directTurnStart=background.indexOf('function directTurnMessage',normalTurnStart);
assert.ok(normalTurnStart>=0&&directTurnStart>normalTurnStart);
assert.ok(background.slice(normalTurnStart,directTurnStart).includes('entry.type !== "provider-event"'),'normal relay must exclude provider events');
const recoveryStart=background.indexOf('function recoveryMessage');
const humanReplyStart=background.indexOf('function humanReplyMessage',recoveryStart);
assert.ok(recoveryStart>=0&&humanReplyStart>recoveryStart);
assert.ok(background.slice(recoveryStart,humanReplyStart).includes('entry.type !== "provider-event"'),'session recovery must exclude provider events');
