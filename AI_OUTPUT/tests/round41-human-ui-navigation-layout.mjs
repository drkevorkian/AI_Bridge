import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const read=name=>fs.readFileSync(path.join(root,'runtime_review',name),'utf8');

const manifest=JSON.parse(read('manifest.json'));
const dashboard=read('dashboard.html');
const layouts=read('dashboard-layouts.js');
const settings=read('settings.js');
const settingsHtml=read('settings.html');
const popup=read('popup.js');
const popupHtml=read('popup.html');

assert.equal(manifest.version,'1.19.0');
assert.equal(manifest.version_name,'AI A 1.19.0-dev.1');
for(const [name,html] of [['dashboard.html',dashboard],['popup.html',popupHtml],['settings.html',settingsHtml]]){
  assert.ok(!html.includes('\\n'),name+' contains literal backslash-n text');
}
assert.ok(layouts.includes('window.location.assign(chrome.runtime.getURL("settings.html"))'));
assert.ok(settings.includes('window.location.assign(chrome.runtime.getURL("dashboard.html"))'));
assert.ok(!layouts.includes('chrome.tabs.create({url:chrome.runtime.getURL("settings.html")}'));
assert.ok(!settings.includes('chrome.tabs.create({url:chrome.runtime.getURL("dashboard.html")}'));
assert.ok(layouts.includes('raw:"classic"'));
assert.ok(settings.includes('?"classic"') || settings.includes(':"classic"'));
assert.ok(dashboard.includes('id="classicRightPanel"'));
assert.ok(settingsHtml.includes('Classic — three-pane workspace'));
assert.ok(settingsHtml.includes('min="20" max="42" step="1" value="26"'));
assert.ok(dashboard.includes('aria-valuemin="20" aria-valuemax="42" aria-valuenow="26"'));
assert.ok(popup.includes('async function openWorkspacePage(page)'));
assert.ok(popup.includes('chrome.tabs.update(existing.id, { url: targetUrl, active: true })'));
console.log('round41-human-ui-navigation-layout: PASS');
