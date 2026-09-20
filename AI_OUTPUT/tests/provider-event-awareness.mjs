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
  'providerEventCandidateElements',
  'inspectProviderEvents(mutations)',
  'closest("[data-message-author-role]")'
]) assert.ok(content.includes(token),'content missing '+token);

assert.ok(/MESSAGE_DELIVERY_TIMEOUT[\s\S]{0,180}ambiguous:\s*true/.test(background),'timeout must be fail-closed/ambiguous');
assert.ok(background.includes('PROVIDER_EVENT_MESSAGE_DELIVERY_TIMEOUT') || background.includes('"PROVIDER_EVENT_"+code'),'ledger failure reason missing');
assert.ok(background.includes('DISPATCH_STATUS.DELIVERY_AMBIGUOUS'),'provider event must be able to mark dispatch ambiguous');
assert.ok(background.includes('recordTranscript("provider-event"'),'provider event must be visible without becoming an AI response');
assert.ok(background.includes('MAX_PROVIDER_EVENTS'),'provider event history must be bounded');
assert.ok(dashboard.includes('entry.type === "provider-event"'),'dashboard provider-event rendering missing');
assert.ok(dashboard.includes('Provider event · AI'),'provider event title missing');
assert.ok(dashboard.includes('e.type === "provider-event"'),'provider events must be included in transcript rendering');

console.log('provider-event-awareness: PASS');
