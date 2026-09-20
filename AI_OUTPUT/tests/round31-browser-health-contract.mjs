import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const background=fs.readFileSync(path.join(root,'runtime_review','background.js'),'utf8');
const harness=fs.readFileSync(path.join(root,'tests','chrome-e2e-runtime.cjs'),'utf8');

const healthStart=background.indexOf('if (msg.type === "AI_BRIDGE_PROVIDER_HEALTH")');
const healthEnd=background.indexOf('if (msg.type === "AI_BRIDGE_GET_STATE")',healthStart);
assert.ok(healthStart>=0 && healthEnd>healthStart,'provider health handler missing');
const healthBlock=background.slice(healthStart,healthEnd);
assert.ok(healthBlock.includes('if (connected && side && !authority)'));
assert.ok(healthBlock.includes('authority = await reviewRegisterSideAuthority(side)'));
assert.ok(healthBlock.includes('actionAuthorityStatus: authority ? "DOCUMENT_AUTHORITY_VERIFIED"'));
assert.ok(healthBlock.includes('const providerBlocked = Boolean(side && state.providerRecovery?.side === side)'));
assert.ok(healthBlock.includes('relay: providerBlocked ? "BLOCKED" : (relayReady ? "READY" : "WAITING")'));

for(const token of [
  'resume.transportOk, true',
  'resume.value?.ok, false',
  'responseCountAfterRestart',
  'responseCountAfterResume',
  "actionAuthorityStatus === 'DOCUMENT_AUTHORITY_VERIFIED'",
  "capabilities?.relay === 'READY'",
  'Provider re-verification must not clear the session pause',
  'Provider re-verification must not resume the session',
  'Connection:',
  'Authority:',
  'Relay:',
  'Verified',
  'READY'
]) assert.ok(harness.includes(token),'harness missing '+token);

console.log('round31-browser-health-contract: PASS');
