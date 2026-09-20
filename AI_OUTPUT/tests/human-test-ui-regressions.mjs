import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,'../..');
const bases=['AI_OUTPUT/runtime_review','AI_INPUT'];
const EXPECTED_VERSION='1.19.1';
const EXPECTED_BUILD='1.19.1.04-AI-A';
const read=p=>fs.readFileSync(path.join(repo,p),'utf8');

function walkTextFiles(root){
  const out=[];
  for(const entry of fs.readdirSync(root,{withFileTypes:true})){
    const full=path.join(root,entry.name);
    if(entry.isDirectory()) out.push(...walkTextFiles(full));
    else if(/\.(?:js|mjs|cjs|json|html|css|md|txt)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

for(const base of bases){
  const manifest=JSON.parse(read(base+'/manifest.json'));
  const dashboard=read(base+'/dashboard.html');
  const dashboardJs=read(base+'/dashboard.js');
  const popup=read(base+'/popup.html');
  const popupJs=read(base+'/popup.js');
  const layouts=read(base+'/dashboard-layouts.js');
  const layoutCss=read(base+'/dashboard-layouts.css');
  const settings=read(base+'/settings.js');
  const settingsHtml=read(base+'/settings.html');

  assert.equal(manifest.version,EXPECTED_VERSION,base+' numeric version mismatch');
  assert.equal(manifest.version_name,EXPECTED_BUILD,base+' build mismatch');

  assert.doesNotMatch(dashboard,/\\n/,'dashboard contains literal \\n: '+base);
  assert.doesNotMatch(popup,/\\n/,'popup contains literal \\n: '+base);

  assert.match(layouts,/window\.location\.assign\(url\)/,'Dashboard Settings must navigate same tab: '+base);
  assert.match(layouts,/navigateToExtensionPage\("settings\.html"\)/,'Dashboard Settings target missing: '+base);
  assert.match(settings,/window\.location\.assign\(url\)/,'Settings Dashboard must navigate same tab: '+base);
  assert.match(settings,/navigateToExtensionPage\("dashboard\.html"\)/,'Settings Dashboard target missing: '+base);
  assert.doesNotMatch(layouts,/openSettings[^\n]*chrome\.tabs\.create/,'Dashboard Settings still creates tabs: '+base);
  assert.doesNotMatch(settings,/openDashboard[^\n]*chrome\.tabs\.create/,'Settings Dashboard still creates tabs: '+base);

  assert.match(layoutCss,/html\[data-layout="classic"\] \.app-shell/,'Classic workspace missing: '+base);
  assert.doesNotMatch(layoutCss,/data-layout="studio"/i,'Studio workspace CSS still exists: '+base);
  assert.doesNotMatch(layoutCss,/data-layout="focus"/i,'Focus workspace CSS still exists: '+base);
  assert.doesNotMatch(layouts,/["']studio["']/i,'Studio workspace JS still exists: '+base);
  assert.doesNotMatch(layouts,/["']focus["']/i,'Focus workspace JS still exists: '+base);
  assert.match(settings,/const LAYOUTS = new Set\(\["classic"\]\)/,'Settings must be Classic-only: '+base);
  assert.doesNotMatch(settingsHtml,/value="studio"|value="focus"/i,'Removed workspace choices still visible: '+base);

  assert.match(popup,/id="buildIdentity"/,'Popup build identity surface missing: '+base);
  assert.match(dashboard,/id="buildIdentity"/,'Dashboard build identity surface missing: '+base);
  assert.match(settingsHtml,/id="installedVersion"/,'Settings version surface missing: '+base);
  assert.match(settingsHtml,/id="installedBuild"/,'Settings build surface missing: '+base);

  for(const source of [popupJs,dashboardJs,settings]){
    assert.match(source,/chrome\.runtime\.getManifest\(\)/,'Visible build identity must come from manifest: '+base);
  }
  assert.doesNotMatch(popup,/themes, layouts,/i,'Popup still advertises removed layouts: '+base);

  const root=path.join(repo,base);
  for(const file of walkTextFiles(root)){
    const text=fs.readFileSync(file,'utf8');
    assert.doesNotMatch(text,/AI A 1\.18\.1|1\.18\.1-human-test|Human Test Build \(AI A 1\.18\.1\)/,
      'stale 1.18.1 package identity remains in '+path.relative(repo,file));
  }
}

const inputManifest=JSON.parse(read('AI_INPUT/manifest.json'));
const outputManifest=JSON.parse(read('AI_OUTPUT/runtime_review/manifest.json'));
assert.equal(inputManifest.version,outputManifest.version,'AI_INPUT and AI_OUTPUT version mismatch');
assert.equal(inputManifest.version_name,outputManifest.version_name,'AI_INPUT and AI_OUTPUT build mismatch');

console.log('human-test-ui-regressions: PASS',EXPECTED_VERSION,EXPECTED_BUILD);
