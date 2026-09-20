import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const harness=fs.readFileSync(path.resolve(here,'chrome-e2e-runtime.cjs'),'utf8');

assert.ok(harness.includes('const lostAckUi = await assertPausedDashboard('));
assert.ok(harness.includes('lostAckUi.pill'));
assert.ok(harness.includes('document.getElementById("healthA")'));
assert.ok(harness.includes('document.getElementById("newChatA")'));
assert.ok(harness.includes('document.getElementById("freshOnStart")'));
assert.ok(harness.includes('lostAckProviderUi.newChatDisabled'));
assert.ok(harness.includes('lostAckProviderUi.freshDisabled'));

const lostAckStart=harness.indexOf('const lostAckUi = await assertPausedDashboard(');
const matrixStart=harness.indexOf('// Recovery-snapshot matrix:',lostAckStart);
assert.ok(lostAckStart>=0 && matrixStart>lostAckStart);
const lostAckBlock=harness.slice(lostAckStart,matrixStart);
assert.ok(!lostAckBlock.includes('document.body.innerText'),'lost-ACK recovery must not use whole-page text');
assert.ok(lostAckBlock.includes('/Connection:\\s*Connected/i'));
assert.ok(lostAckBlock.includes('/Authority:\\s*Verified/i'));
assert.ok(lostAckBlock.includes('/Relay:\\s*READY/i'));
assert.ok(lostAckBlock.includes('/Rollover:\\s*LIMITED/i'));
assert.ok(lostAckBlock.includes('/Artifacts:\\s*LIMITED/i'));

assert.ok(!harness.includes('assert.match(missingContinuationUi, /Paused/i)'));
assert.ok(!harness.includes('assert.match(uncommittedSourceUi, /Paused/i)'));
assert.ok(harness.includes('positiveUi.status'));
assert.ok(harness.includes('createdUi.status'));

console.log('round36-lost-ack-element-ui: PASS');
