import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..','..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const exists=rel=>fs.existsSync(path.join(root,rel));
const requireFile=(rel,label=rel)=>assert.ok(exists(rel),`${label} is missing: ${rel}`);
const manifest=JSON.parse(read('manifest.json'));

assert.equal(manifest.manifest_version,3,'AI Bridge must remain a Manifest V3 extension.');
assert.equal(typeof manifest.name,'string');
assert.match(String(manifest.version||''),/^\d+\.\d+\.\d+$/,'manifest.version must be semver-like.');

const entrypoints=[];
const serviceWorker=manifest.background?.service_worker;
assert.ok(serviceWorker,'manifest.background.service_worker is required.');
entrypoints.push(serviceWorker);
const popup=manifest.action?.default_popup;
assert.ok(popup,'manifest.action.default_popup is required.');
entrypoints.push(popup);
for(const script of manifest.content_scripts||[]){
  assert.ok(Array.isArray(script.matches)&&script.matches.length,'each content script needs matches.');
  assert.ok(Array.isArray(script.js)&&script.js.length,'each content script needs JavaScript files.');
  entrypoints.push(...script.js);
}
for(const rel of new Set(entrypoints))requireFile(rel,'manifest entrypoint');

for(const icon of Object.values(manifest.icons||{}))requireFile(icon,'manifest icon');
for(const icon of Object.values(manifest.action?.default_icon||{}))requireFile(icon,'action icon');

const requiredProviderHosts=['chatgpt.com','grok.com','claude.ai','gemini.google.com','copilot.microsoft.com'];
const hostText=(manifest.host_permissions||[]).join('\n');
const matchText=(manifest.content_scripts||[]).flatMap(x=>x.matches||[]).join('\n');
for(const host of requiredProviderHosts){
  assert.ok(hostText.includes(host),`host_permissions must include ${host}`);
  assert.ok(matchText.includes(host),`content_scripts.matches must include ${host}`);
}

const requiredUi=['popup.html','popup.js','popup.css','dashboard.html','dashboard.js','dashboard.css','settings.html','settings.js','settings.css'];
for(const rel of requiredUi)requireFile(rel,'UI asset');

function localRefs(htmlRel){
  const html=read(htmlRel);
  const refs=[];
  for(const re of [/<script\b[^>]*\bsrc=["']([^"']+)["']/gi,/<link\b[^>]*\bhref=["']([^"']+)["']/gi]){
    let m;while((m=re.exec(html)))refs.push(m[1]);
  }
  return refs.filter(ref=>!/^([a-z]+:)?\/\//i.test(ref)&&!ref.startsWith('data:')&&!ref.startsWith('#'));
}
for(const htmlRel of ['popup.html','dashboard.html','settings.html']){
  for(const ref of localRefs(htmlRel))requireFile(path.normalize(path.join(path.dirname(htmlRel),ref)),`${htmlRel} referenced asset`);
}

const background=read('background.js');
const contentScript=read('content.js');
const popupJs=read('popup.js');
const dashboardJs=read('dashboard.js');
const settingsJs=read('settings.js');
const uiSource=[popupJs,dashboardJs,settingsJs].join('\n');

const requiredBackgroundMessages=['AI_BRIDGE_GET_STATE','AI_BRIDGE_OPEN_DASHBOARD','AI_BRIDGE_PAUSE','AI_BRIDGE_STOP'];
for(const type of requiredBackgroundMessages){
  assert.ok(uiSource.includes(type),`UI should use ${type}`);
  assert.ok(background.includes(type),`background.js must handle ${type}`);
}
const requiredContentMessages=['AI_BRIDGE_PING','AI_BRIDGE_SEND','AI_BRIDGE_NEW_CHAT','AI_BRIDGE_READ_LAST_RESPONSE'];
for(const type of requiredContentMessages)assert.ok(contentScript.includes(type),`content.js must handle ${type}`);
assert.ok(background.includes('AI_BRIDGE_RESPONSE'),'background.js must receive AI_BRIDGE_RESPONSE.');
assert.ok(contentScript.includes('AI_BRIDGE_RESPONSE'),'content.js must emit AI_BRIDGE_RESPONSE.');

const csp=String(manifest.content_security_policy?.extension_pages||'');
assert.ok(csp.includes("script-src 'self'"),'extension CSP must restrict scripts to self.');
assert.ok(csp.includes("object-src 'none'"),'extension CSP must disable object sources.');

console.log('chrome-extension-smoke: PASS');
console.log(`manifest ${manifest.version}: MV3 entrypoints, provider hosts, UI assets, message wiring, and CSP are structurally present.`);
