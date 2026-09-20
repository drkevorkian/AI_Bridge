import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,'../..');
const read=p=>fs.readFileSync(path.join(repo,p),'utf8');
for(const base of ['AI_OUTPUT/runtime_review','AI_INPUT']){
  const dashboard=read(base+'/dashboard.html');
  const popup=read(base+'/popup.html');
  const layouts=read(base+'/dashboard-layouts.js');
  const layoutCss=read(base+'/dashboard-layouts.css');
  const settings=read(base+'/settings.js');
  const manifest=JSON.parse(read(base+'/manifest.json'));
  assert.doesNotMatch(dashboard,/\\n/,'dashboard contains literal \\n: '+base);
  assert.doesNotMatch(popup,/\\n/,'popup contains literal \\n: '+base);
  assert.ok(layouts.includes('window.location.assign(chrome.runtime.getURL("settings.html"))'),'Dashboard Settings must navigate same tab: '+base);
  assert.ok(settings.includes('window.location.assign(chrome.runtime.getURL("dashboard.html"))'),'Settings Dashboard must navigate same tab: '+base);
  assert.doesNotMatch(layouts,/openSettings[^\n]*chrome\.tabs\.create/,'Dashboard Settings still creates tabs: '+base);
  assert.doesNotMatch(settings,/openDashboard[^\n]*chrome\.tabs\.create/,'Settings Dashboard still creates tabs: '+base);
  for(const layout of ['classic','studio','focus']) assert.ok(layoutCss.includes('html[data-layout="'+layout+'"] .app-shell'),'missing '+layout+' structure: '+base);
  assert.ok(layoutCss.includes('html[data-layout="focus"] .control-panel>:not(.brand-block):not(.runtime-card)'),'Focus must be transcript-first: '+base);
  assert.ok(settings.includes('LAYOUTS.has(layout)?layout:"classic"'),'Classic setter fallback missing: '+base);
  assert.equal(manifest.version,'1.19.1');
}
assert.equal(JSON.parse(read('AI_INPUT/manifest.json')).version_name,'AI B 1.19.1-human-test');
assert.equal(JSON.parse(read('AI_OUTPUT/runtime_review/manifest.json')).version_name,'AI B 1.19.1-playground');
console.log('human-test-ui-regressions: PASS');

for(const base of ['AI_OUTPUT/runtime_review','AI_INPUT']){
  const css=read(base+'/dashboard-layouts.css');
  const js=read(base+'/dashboard-layouts.js');
  const settingsHtml=read(base+'/settings.html');
  assert.ok(css.includes('grid-column:3;grid-row:1'),'Studio must dock controls on the right: '+base);
  assert.ok(css.includes('position:fixed;z-index:20;left:14px;top:14px'),'Focus must use a floating runtime rail: '+base);
  assert.ok(css.includes('grid-column:4;display:block'),'Classic must expose the right-side secondary pane: '+base);
  assert.ok(js.includes('layout==="studio" ? ((window.innerWidth-x)/window.innerWidth)*100'),'Studio splitter must resize from the right edge: '+base);
  assert.ok(settingsHtml.includes('Workspace theme'),'Settings must label these as workspace themes: '+base);
}
