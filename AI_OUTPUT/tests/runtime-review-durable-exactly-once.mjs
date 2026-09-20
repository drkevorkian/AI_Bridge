import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const runtime=path.resolve(here,'..','runtime_review');
const coreSource=fs.readFileSync(path.join(runtime,'runtime-core.js'),'utf8');
const background=fs.readFileSync(path.join(runtime,'background.js'),'utf8');
const content=fs.readFileSync(path.join(runtime,'content.js'),'utf8');

const context={globalThis:{}};
context.globalThis=context;
vm.createContext(context);
vm.runInContext(coreSource,context,{filename:'runtime-core.js'});
const core=context.AIBridgeRuntimeCore;
assert.ok(core?.ledger?.DispatchLedger,'DispatchLedger missing from bundled runtime core');
assert.ok(core?.responseGate?.validateIncomingResponse,'IncomingResponseGate missing from bundled runtime core');
assert.ok(core?.parked?.ParkedResponseStore,'ParkedResponseStore missing from bundled runtime core');

const {DispatchLedger,DISPATCH_STATUS}=core.ledger;
const identity={provider:'chatgpt',kind:'conversation',routeClass:'conversation',threadKey:'thread-a',provisional:false,writable:true};
let ledger=new DispatchLedger();
ledger.create({dispatchId:'d1',side:'A',tabId:7,generationEpoch:3,conversationIdentity:identity,purpose:'RELAY',payloadHash:'hash-a',createdAt:100});
ledger.transition('d1',DISPATCH_STATUS.DISPATCHING);
const restored=new DispatchLedger(ledger.snapshot());
restored.transition('d1',DISPATCH_STATUS.DELIVERY_AMBIGUOUS,{failureReason:'MV3_WORKER_RESTART_DURING_DELIVERY'});
assert.equal(restored.get('d1').status,DISPATCH_STATUS.DELIVERY_AMBIGUOUS);
assert.throws(()=>restored.transition('d1',DISPATCH_STATUS.DISPATCHING));

assert.ok(background.includes('MV3_WORKER_RESTART_DURING_DELIVERY'));
assert.ok(background.includes('UNRESOLVED_DISPATCH_BLOCKS_REPLAY'));
assert.ok(background.includes('reviewProcessIncomingEnvelope'));
assert.ok(background.includes('reviewParkedStore.claim'));
assert.ok(background.includes('DISPATCH_STATUS.RESPONSE_COMMITTED'));
assert.ok(background.includes('relay: false'));
assert.ok(background.indexOf('DISPATCH_STATUS.RESPONSE_COMMITTED') < background.indexOf('reviewContinueAfterCommittedResponse(envelope.side)'));
assert.ok(content.includes('generationEpoch:registration.generationEpoch'));
assert.ok(content.includes('conversationIdentity:registration.identity'));
assert.ok(content.includes('dispatchId'));

console.log('runtime-review-durable-exactly-once: PASS');
