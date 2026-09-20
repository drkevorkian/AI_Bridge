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
assert.ok(background.includes('REVIEW_MANIFEST = chrome.runtime.getManifest()'),'background must derive runtime build from manifest');
assert.ok(background.includes('const CONTENT_VERSION = String(REVIEW_MANIFEST.version_name || REVIEW_MANIFEST.version || "unknown")'),'background CONTENT_VERSION must be manifest-derived');
assert.ok(background.includes('const REVIEW_RUNTIME_VERSION = CONTENT_VERSION'),'review runtime version must share content build identity');
assert.ok(content.includes('const manifest = chrome.runtime.getManifest()'),'content runtime must derive build from manifest');
assert.ok(content.includes('const CONTENT_BUILD = String(manifest.version_name || manifest.version || "unknown")'),'content runtime build must be manifest-derived');
assert.ok(content.includes('const VERSION = CONTENT_BUILD'),'content ping version must match manifest build');
assert.ok(content.includes('__AI_BRIDGE_CONTENT_RUNTIME__'),'version-aware content runtime missing');

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

assert.ok(background.startsWith('importScripts("runtime-core.js","update-checkpoint.js");'),'review background must load runtime core and durable update checkpoint before startup');
assert.equal(background.split('importScripts("runtime-core.js","update-checkpoint.js");').length-1,1,'review startup imports must be declared exactly once');
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
assert.ok(content.includes('CONTENT_RUNTIME_SCHEMA = 1'));
assert.ok(content.includes('LEGACY_RUNTIME_NOT_DISPOSABLE'));
assert.ok(content.includes('observer.disconnect()'));
assert.ok(content.includes('removeListener(onRuntimeMessage)'));
assert.ok(background.includes('CONTENT_RUNTIME_UPGRADE_NOT_PROVEN'));
assert.ok(background.includes('chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] })'));
assert.doesNotMatch(background,/chrome\.tabs\.reload\(tabId\)/,'content upgrade must never reload provider tab');
assert.ok(background.includes('AI_BRIDGE_PROVIDER_EVENT'));
assert.ok(background.includes('PROVIDER_EVENT_POLICY'));
assert.ok(background.includes('providerEvents'));
assert.ok(background.includes('providerRecovery'));
assert.ok(background.includes('PROVIDER_RECOVERY_REQUIRED'));
assert.ok(background.includes('PROVIDER_RESPONSE_RECOVERED'));
assert.ok(background.includes('WAITING_SAME_DISPATCH'));
assert.ok(background.includes('entry?.type !== "provider-event"'));
assert.ok(dashboard.includes('Provider recovery required'));
assert.ok(dashboard.includes('Provider response recovered'));
assert.ok(dashboard.includes('provider-event'));
assert.ok(content.includes('generationEpoch:registration.generationEpoch'));
assert.ok(content.includes('conversationIdentity:registration.identity'));
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
assert.ok(background.includes('providerRecovery'));
assert.ok(background.includes('PROVIDER_RECOVERY_REQUIRED'));
assert.ok(background.includes('PROVIDER_EVENT_IDENTITY_MISMATCH'));
assert.ok(background.includes('PROVIDER_EVENT_GENERATION_MISMATCH'));
assert.ok(background.includes('PROVIDER_EVENT_REGISTRATION_MISMATCH'));
assert.ok(background.includes('PROVIDER_EVENT_DOCUMENT_MISMATCH'));
assert.ok(background.includes('reviewAuthorizeProviderEvent'));
assert.ok(background.includes('nextTurnPending'));
assert.ok(background.includes('reviewRegisterSideAuthority(side)'));
assert.ok(dashboard.includes('function refreshProviderHealth'));
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


assert.equal(background.split('const PROVIDER_EVENT_POLICY = Object.freeze(').length-1,1,'duplicate provider event policy declaration');
assert.equal(content.split('function classifyProviderEvent(').length-1,1,'duplicate provider event classifier declaration');
assert.doesNotMatch(content,/function normalizeNoticeText\(/);
assert.doesNotMatch(content,/inspectProviderEvents\(/);
assert.ok(background.includes('const authorized=reviewAuthorizeProviderEvent(msg,sender)'));
