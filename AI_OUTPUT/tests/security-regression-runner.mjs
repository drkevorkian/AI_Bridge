import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const tests=[
  'round10-dom-authority.mjs',
  'round13-pause-canonical.mjs',
  'round14-adapter.mjs',
  'provider-limit-signatures.mjs',
  'agent-participation-guard.mjs',
  'thread-rollover.mjs',
  'conversation-authority.mjs',
  'dispatch-ledger.mjs',
  'round4-backend.mjs',
  'exactly-once-rollover.mjs',
  'round8-backend.mjs',
  'round12-storage-api.mjs',
  'round13-storage-transaction.mjs',
  'bounded-bootstrap.mjs',
  'round22-authority-runtime.mjs',
  'round23-registration-health.mjs',
  'round25-provider-health-failclosed.mjs',
  'round41-thread-limit-continuity.mjs',
  'update-system-atomic.mjs',
  'round42-content-runtime-lifecycle.mjs',
  'round43-next-turn-adoption.mjs',
  'round44-restart-delivery-recovery.mjs',
  'dom-authority-disabled-send.mjs',
  'update-checkpoint-crash-stages.mjs',
  'update-checkpoint-runtime-contract.mjs',
  'update-control-sender-trust.mjs'
];
for(const name of tests){
  const r=spawnSync(process.execPath,[path.join(here,name)],{stdio:'inherit'});
  if(r.status!==0)process.exit(r.status??1);
}
console.log('security-regression-runner: PASS');
