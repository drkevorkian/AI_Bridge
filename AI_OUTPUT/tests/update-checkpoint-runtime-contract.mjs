import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'..');
const bg=fs.readFileSync(path.join(root,'runtime_review','background.js'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'runtime_review','manifest.json'),'utf8'));
for(const token of ['importScripts("runtime-core.js","update-checkpoint.js")','UPDATE_CHECKPOINT_BLOCKS_NEW_DISPATCH','updateDrainMatch=state.updateCheckpoint?.phase===UPDATE_PHASE.DRAINING','reviewCheckpointAtSafeBoundary','reviewRestoreUpdateCheckpointIfNeeded','AI_BRIDGE_UPDATE_PREPARE','AI_BRIDGE_UPDATE_BEGIN_APPLY','AI_BRIDGE_UPDATE_APPLIED','AI_BRIDGE_UPDATE_CANCEL','chrome.runtime.reload()','UPDATE_CONTROL_UNTRUSTED_SENDER','verifyReloadTarget'])assert.ok(bg.includes(token),'missing '+token);
assert.equal(manifest.version_name,'1.19.1.05-AI-B');
assert.ok(bg.indexOf('await reviewParkedStore.finalize(envelope.dispatchId);')<bg.indexOf('if(state.updateCheckpoint?.phase===UPDATE_PHASE.DRAINING)'));
console.log('update-checkpoint-runtime-contract: PASS');
