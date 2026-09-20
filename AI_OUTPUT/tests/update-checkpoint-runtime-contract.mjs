import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));const root=path.resolve(here,'..');
const bg=fs.readFileSync(path.join(root,'runtime_review','background.js'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'runtime_review','manifest.json'),'utf8'));
for(const token of [
  'importScripts("runtime-core.js","update-checkpoint.js")',
  'UPDATE_CHECKPOINT_BLOCKS_NEW_DISPATCH',
  'reviewCaptureUpdateBindings','reviewVerifyReboundBindings',
  'UPDATE_REBIND_DOCUMENT_MISMATCH','UPDATE_REBIND_GENERATION_MISMATCH','UPDATE_REBIND_IDENTITY_MISMATCH',
  'APPLIED_NOT_RELOADED','RELOADED_NOT_REBOUND','READY_TO_RESUME',
  'AI_BRIDGE_UPDATE_PREPARE','AI_BRIDGE_UPDATE_APPLIED','AI_BRIDGE_UPDATE_CANCEL','AI_BRIDGE_UPDATE_STATUS',
  'chrome.runtime.reload()','UPDATE_RECOVERY_IN_PROGRESS','updateAllowsOrdinaryRecovery'
]) assert.ok(bg.includes(token),'missing '+token);
assert.equal(manifest.version_name,'1.19.1.05-AI-B');
assert.ok(bg.indexOf('await reviewParkedStore.finalize(envelope.dispatchId);')<bg.indexOf('if(state.updateCheckpoint?.phase===UPDATE_PHASE.DRAINING)'));
assert.doesNotMatch(bg,/chrome\.tabs\.reload\(tabId\)/);
console.log('update-checkpoint-runtime-contract: PASS');

assert.ok(bg.includes('if (state.sessionActive && state.running && updateAllowsOrdinaryRecovery)'));
assert.doesNotMatch(bg,/state\.sessionActive && state\.running && !state\.updateCheckpoint\?\.phase \|\|/);
