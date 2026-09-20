import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const source=path.resolve(here,'..','runtime_review');
function chromeBinary(){
  const candidates=process.platform==='win32'
    ? [process.env.CHROME_BIN,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe']
    : process.platform==='darwin'
      ? [process.env.CHROME_BIN,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium']
      : [process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'];
  for(const p of candidates.filter(Boolean)){try{fs.accessSync(p,fs.constants.X_OK);return p;}catch{}}
  throw new Error('Chrome/Chromium binary not found. Set CHROME_BIN.');
}
assert.ok(fs.existsSync(path.join(source,'manifest.json')),'runtime_review manifest missing');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'ai-bridge-runtime-pack-'));
const ext=path.join(work,'AI_Bridge_Runtime_Review');
fs.cpSync(source,ext,{recursive:true});
const chrome=chromeBinary();
try{
  const r=spawnSync(chrome,['--no-sandbox',`--pack-extension=${ext}`],{encoding:'utf8',timeout:30000});
  assert.equal(r.status,0,`Chrome pack failed: ${r.stderr||r.stdout}`);
  assert.ok(fs.existsSync(ext+'.crx'));
  assert.ok(fs.statSync(ext+'.crx').size>0);
  console.log(`runtime-review-pack-smoke: PASS (${chrome})`);
}finally{
  fs.rmSync(work,{recursive:true,force:true});
  try{fs.rmSync(ext+'.crx',{force:true});fs.rmSync(ext+'.pem',{force:true});}catch{}
}
