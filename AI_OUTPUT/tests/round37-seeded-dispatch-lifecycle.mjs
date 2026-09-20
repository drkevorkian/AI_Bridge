import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const harness=fs.readFileSync(path.resolve(here,'chrome-e2e-runtime.cjs'),'utf8');

for(const token of [
  'const baseDispatchCreatedAt =',
  'const baseDispatchAcceptedAt =',
  'acceptedAt: baseDispatchAcceptedAt',
  'completedAt: null',
  'const committedBaseDispatch =',
  "status: 'RESPONSE_COMMITTED'",
  'completedAt: baseDispatchAcceptedAt + 1'
]) assert.ok(harness.includes(token),'missing lifecycle token '+token);

const committedRefs=(harness.match(/committedBaseDispatch/g)||[]).length;
assert.ok(committedRefs >= 5,'expected committed template definition plus multiple seeded uses');

const case2Start=harness.indexOf('// Case 2:');
const case3Start=harness.indexOf('// Case 3:',case2Start);
assert.ok(case2Start>=0 && case3Start>case2Start);
const case2=harness.slice(case2Start,case3Start);
assert.ok(case2.includes("status: 'AWAITING_RESPONSE'"));

const createdStart=harness.indexOf('const createdTarget = {');
const createdEnd=harness.indexOf('const createdActionCountBefore',createdStart);
assert.ok(createdStart>=0 && createdEnd>createdStart);
const createdBlock=harness.slice(createdStart,createdEnd);
assert.ok(createdBlock.includes("status: 'CREATED'"));
assert.ok(createdBlock.includes('acceptedAt: null'));
assert.ok(createdBlock.includes('completedAt: null'));

const ambiguousStart=harness.indexOf("for (const seededStatus of ['DISPATCHING', 'ACCEPTED'])");
assert.ok(ambiguousStart>=0);
const ambiguousBlock=harness.slice(ambiguousStart);
assert.ok(ambiguousBlock.includes("...(seededStatus === 'ACCEPTED' ? { acceptedAt: Date.now() } : {})"));
assert.ok(ambiguousBlock.includes('...positiveStorage.target'));

console.log('round37-seeded-dispatch-lifecycle: PASS');
