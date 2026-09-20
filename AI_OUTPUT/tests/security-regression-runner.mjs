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
  'round22-authority-runtime.mjs',
  'round23-registration-health.mjs'
];
for(const name of tests){
  const r=spawnSync(process.execPath,[path.join(here,name)],{stdio:'inherit'});
  if(r.status!==0)process.exit(r.status??1);
}
console.log('security-regression-runner: PASS');
