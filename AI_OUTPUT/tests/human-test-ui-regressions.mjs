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
  const css=read(base+'/dashboard-layouts.css');
  const settings=read(base+'/settings.js');
  const settingsHtml=read(base+'/settings.html');
  const manifest=JSON.parse(read(base+'/manifest.json'));

  assert.doesNotMatch(dashboard,/\\n/,'dashboard contains literal \\n: '+base);
  assert.doesNotMatch(popup,/\\n/,'popup contains literal \\n: '+base);
  assert.ok(layouts.includes('window.location.assign(chrome.runtime.getURL("settings.html"))'),'same-tab Settings missing: '+base);
  assert.ok(settings.includes('window.location.assign(chrome.runtime.getURL("dashboard.html"))'),'same-tab Dashboard missing: '+base);

  assert.ok(css.includes('html[data-layout="classic"] .app-shell'),'Classic layout missing: '+base);
  assert.doesNotMatch(css,/data-layout="studio"/,'Studio CSS must be removed: '+base);
  assert.doesNotMatch(css,/data-layout="focus"/,'Focus CSS must be removed: '+base);
  assert.doesNotMatch(layouts,/["']studio["']/,'Studio JS must be removed: '+base);
  assert.doesNotMatch(layouts,/["']focus["']/,'Focus JS must be removed: '+base);

  assert.ok(settings.includes('const LAYOUTS = new Set(["classic"])'),'Settings must permit Classic only: '+base);
  assert.doesNotMatch(settingsHtml,/value="studio"/,'Studio option must be removed: '+base);
  assert.doesNotMatch(settingsHtml,/value="focus"/,'Focus option must be removed: '+base);
  assert.ok(settingsHtml.includes('value="Classic" readonly'),'Classic workspace indicator missing: '+base);
  assert.ok(settingsHtml.includes('id="installedBuild"'),'visible build field missing: '+base);

  assert.equal(manifest.version,'1.19.1');
  assert.equal(manifest.version_name,'1.19.1.03-AI-B');
}
console.log('human-test-ui-regressions: PASS');
