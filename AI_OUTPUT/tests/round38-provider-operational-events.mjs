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
  'function classifyProviderEvent',
  'MESSAGE_DELIVERY_TIMEOUT',
  'AI_BRIDGE_PROVIDER_EVENT',
  'await inspectProviderEvent()',
  'providerEventBaseline',
  'authorityRegistrationId:registration.authorityRegistrationId',
  'provider_events: "PASS"',
  'PROVIDER_EVENT_ACTIVE'
]) assert.ok(content.includes(token),'content missing '+token);

const classifierStart=content.indexOf('function normalizeProviderEventText');
const classifierEnd=content.indexOf('function operationalEventTexts',classifierStart);
assert.ok(classifierStart>=0 && classifierEnd>classifierStart);
const classifierSource=content.slice(classifierStart,classifierEnd);
const classify=(new Function(classifierSource+'; return classifyProviderEvent;'))();
assert.equal(classify('Message delivery timed out. Please try again.')?.code,'MESSAGE_DELIVERY_TIMEOUT');
assert.equal(classify('Connection interrupted. Waiting for the complete answer.')?.code,'CONNECTION_INTERRUPTED');
assert.equal(classify("You've reached the maximum length for this conversation."),null);
assert.equal(classify('A normal assistant answer about network design.'),null);
assert.ok(content.includes('!node.closest("[data-message-author-role=\'assistant\'],[data-message-author-role=\\\"assistant\\\"]")'),'provider-event probes must exclude assistant-message DOM');
const inspectStart=content.indexOf('async function inspectProviderEvent');
const inspectEnd=content.indexOf('function responseText',inspectStart);
const inspectSource=content.slice(inspectStart,inspectEnd);
assert.doesNotMatch(inspectSource,/responseText\s*\(/,'response bodies must not be treated as operational event probes');

for(const token of [
  'PROVIDER_EVENT_POLICY',
  'if (msg.type === "AI_BRIDGE_PROVIDER_EVENT")',
  'type === "provider-event"',
  'runtimePhase = "PROVIDER_RECOVERY_REQUIRED"',
  'relay: providerBlocked ? "BLOCKED"',
  'PROVIDER_RECOVERY_REQUIRED: resolve the provider error',
  'entry.type !== "provider-event"',
  'matchingProviderRecovery?.resumeRelayAfterResponse'
]) assert.ok(background.includes(token),'background missing '+token);

for(const token of [
  'PROVIDER_RECOVERY_REQUIRED: "Provider recovery required"',
  's.providerRecovery',
  'function refreshProviderHealth',
  'Relay: ${relay}',
  'entry.type === "provider-event"'
]) assert.ok(dashboard.includes(token),'dashboard missing '+token);

console.log('round38-provider-operational-events: PASS');
