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
  'manifest.json','background.js','content.js',
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

const background=read('background.js');
const content=read('content.js');
const settings=read('settings.js');

assert.doesNotMatch(background,/^\s*import\s/m);
assert.doesNotMatch(background,/^\s*export\s/m);
assert.doesNotMatch(content,/^\s*import\s/m);
assert.doesNotMatch(content,/^\s*export\s/m);

const listenerIndex=background.indexOf('chrome.runtime.onMessage.addListener');
const awaitIndex=background.indexOf('await stateReady');
assert.ok(listenerIndex>=0 && awaitIndex>=0 && listenerIndex<awaitIndex,'MV3 listener must register before async state readiness');

assert.ok(background.includes('AI_BRIDGE_DOCUMENT_REGISTER'));
assert.ok(background.includes('{ documentId: authority.documentId }'));
assert.ok(background.includes('DELIVERY_AMBIGUOUS'));
assert.ok(content.includes('AI_BRIDGE_ACTION'));
assert.ok(content.includes('NEW_CHAT_UNSUPPORTED'));
assert.ok(content.includes('UPLOAD_UNSUPPORTED'));
assert.ok(content.includes('AI_BRIDGE_THREAD_LIMIT'));
assert.ok(settings.includes('AI_BRIDGE_PROVIDER_HEALTH'));

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
