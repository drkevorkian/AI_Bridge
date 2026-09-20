import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const runtime=path.join(root,'runtime_review');
const read=rel=>fs.readFileSync(path.join(runtime,rel),'utf8');
const exists=rel=>fs.existsSync(path.join(runtime,rel));

for(const rel of [
  'manifest.json','runtime-core.js','background.js','content.js',
  'popup.html','popup.js','popup.css',
  'dashboard.html','dashboard.js','dashboard.css',
  'dashboard-layouts.js','dashboard-layouts.css',
  'settings.html','settings.js','settings.css','icon128.png'
]) assert.ok(exists(rel),rel+' missing from runtime_review');

const manifest=JSON.parse(read('manifest.json'));
assert.equal(manifest.manifest_version,3);
assert.equal(manifest.background?.service_worker,'background.js');
assert.equal(manifest.background?.type,undefined);
assert.deepEqual(manifest.content_scripts?.[0]?.js,['content.js']);
assert.ok(String(manifest.name).includes('Review'));

const runtimeCore=read('runtime-core.js');
const background=read('background.js');
const content=read('content.js');
const settings=read('settings.js');
const dashboard=read('dashboard.js');
const dashboardHtml=read('dashboard.html');
const backgroundContentVersion=background.match(/const CONTENT_VERSION = "([^"]+)";/)?.[1] || "";
const contentVersion=content.match(/const VERSION = "([^"]+)";/)?.[1] || "";
assert.ok(backgroundContentVersion,'background CONTENT_VERSION missing');
assert.ok(contentVersion,'content VERSION missing');
assert.equal(backgroundContentVersion,contentVersion,'background/content runtime versions must match exactly');

assert.doesNotMatch(background,/^\s*import\s/m);
assert.doesNotMatch(background,/^\s*export\s/m);
assert.doesNotMatch(content,/^\s*import\s/m);
assert.doesNotMatch(content,/^\s*export\s/m);

const listenerIndex=background.indexOf('chrome.runtime.onMessage.addListener');
assert.ok(listenerIndex>=0,'MV3 runtime listener missing');
assert.doesNotMatch(
  background.slice(0,listenerIndex),
  /^await stateReady\b/m,
  'MV3 listener must register before any top-level state-readiness wait'
);

assert.ok(background.startsWith('importScripts("runtime-core.js");'));
assert.ok(runtimeCore.includes('DispatchLedger'));
assert.ok(runtimeCore.includes('validateIncomingResponse'));
assert.ok(runtimeCore.includes('ParkedResponseStore'));
assert.ok(background.includes('AI_BRIDGE_DOCUMENT_REGISTER'));
assert.ok(background.includes('{ documentId: authority.documentId }'));
assert.ok(background.includes('DELIVERY_AMBIGUOUS'));
assert.ok(content.includes('AI_BRIDGE_ACTION'));
assert.ok(content.includes('NEW_CHAT_UNSUPPORTED'));
assert.ok(content.includes('UPLOAD_UNSUPPORTED'));
assert.ok(content.includes('AI_BRIDGE_THREAD_LIMIT'));
assert.ok(content.includes('AI_BRIDGE_PROVIDER_EVENT'));
assert.ok(content.includes('MESSAGE_DELIVERY_TIMEOUT'));
assert.ok(background.includes('AI_BRIDGE_PROVIDER_EVENT'));
assert.ok(background.includes('PROVIDER_EVENT_POLICY'));
assert.ok(background.includes('providerEvents'));
assert.ok(background.includes('providerRecovery'));
assert.ok(background.includes('PROVIDER_EVENT_AUTHORITY_TOKEN_MISMATCH'));
assert.ok(background.includes('PROVIDER_EVENT_GENERATION_MISMATCH'));
assert.ok(background.includes('PROVIDER_EVENT_IDENTITY_MISMATCH'));
assert.ok(background.includes('PROVIDER_RECOVERY_REQUIRED'));
assert.ok(background.includes('PROVIDER_RESPONSE_RECOVERED'));
assert.ok(background.includes('WAITING_SAME_DISPATCH'));
assert.ok(background.includes('entry?.type !== "provider-event"'));
assert.ok(dashboard.includes('Provider recovery required'));
assert.ok(dashboard.includes('Provider response recovered'));
assert.ok(dashboard.includes('provider-event'));
assert.ok(content.includes('generationEpoch:registration.generationEpoch'));
assert.ok(content.includes('conversationIdentity:registration.identity'));
assert.ok(content.includes('authorityRegistrationId:registration?.authorityRegistrationId'));
assert.ok(settings.includes('AI_BRIDGE_PROVIDER_HEALTH'));
assert.ok(background.includes('if (connected && side && !authority)'));
assert.ok(background.includes('authority = await reviewRegisterSideAuthority(side)'));
assert.ok(background.includes('reviewLedger.create'));
assert.ok(background.includes('reviewPersistLedger'));
assert.ok(background.includes('DISPATCH_STATUS.DELIVERY_AMBIGUOUS'));
assert.ok(background.includes('validateIncomingResponse'));
assert.ok(background.includes('reviewParkedStore.claim'));
assert.ok(background.includes('relay: false'));
assert.ok(background.includes('reviewContinueAfterCommittedResponse'));
assert.ok(background.includes('continuationSourceDispatchId'));
assert.ok(background.includes('reviewRecoverNextTurnPending'));
assert.ok(background.includes('RUNTIME_CONTINUATION_STATE_INCONSISTENT'));
assert.ok(background.includes('reviewEnforceContinuationConsistency'));
assert.ok(background.includes('reviewCommittedWithoutContinuationIsInconsistent'));
assert.ok(background.includes('reviewPersistNextTurnPending'));
assert.ok(background.includes('reviewBuildNextTurnPending'));
assert.ok(background.includes('RECOVERING_NEXT_TURN'));
assert.ok(background.includes('NEXT_TURN_PENDING'));
assert.ok(background.includes('nextTurnPending'));
assert.ok(background.includes('reviewRegisterSideAuthority(side)'));
assert.ok(dashboard.includes('refreshProviderHealth'));
assert.ok(dashboard.includes('runtimePhaseLabel'));
assert.ok(dashboard.includes('recovering next relay turn'));
assert.ok(dashboard.includes('New Chat is LIMITED'));
assert.ok(dashboardHtml.includes('New chat — Limited'));
assert.ok(dashboardHtml.includes('Start in fresh AI chats — Limited'));

assert.doesNotMatch(content,/new KeyboardEvent\s*\(/);
assert.doesNotMatch(content,/visibleNewChatControl/);
assert.doesNotMatch(background,/type:\s*"AI_BRIDGE_NEW_CHAT"\s*\}/);
assert.doesNotMatch(background,/result\s*=\s*await chrome\.tabs\.sendMessage\(Number\(tabId\),\s*\{\s*type:\s*"AI_BRIDGE_SEND"/);

for(const html of ['popup.html','dashboard.html','settings.html']){
  const source=read(html);
  for(const match of source.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/gi)){
    const ref=match[1];
    if(/^(?:https?:|data:|#)/i.test(ref)) continue;
    assert.ok(exists(ref),html+' references missing '+ref);
  }
}
console.log('runtime-review-contract: PASS');
