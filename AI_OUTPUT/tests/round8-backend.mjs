import assert from "node:assert/strict";
import parkedModule from "../thread_rollover/parked-response-store.js";
import ledgerModule from "../thread_rollover/dispatch-ledger.js";

const{RECORD_STATE,RECONCILE,ParkedResponseStore}=parkedModule;
const{DISPATCH_STATUS,DispatchLedger}=ledgerModule;

class MemoryStore{
  constructor(seed={}){this.data=structuredClone(seed);}
  async load(key){return structuredClone(this.data[key]??null);}
  async save(key,value){await Promise.resolve();this.data[key]=structuredClone(value);}
}

const identity={provider:"chatgpt",kind:"conversation",routeClass:"conversation",threadKey:"new",writable:true,provisional:false};
const surface={provider:"chatgpt",kind:"surface",routeClass:"home",threadKey:null,writable:true,provisional:true};
const ledger=new DispatchLedger();
ledger.create({dispatchId:"d1",side:"B",tabId:10,generationEpoch:6,conversationIdentity:surface,purpose:"CONTINUITY",payloadHash:"h",createdAt:1});
ledger.transition("d1",DISPATCH_STATUS.DISPATCHING);
ledger.transition("d1",DISPATCH_STATUS.ACCEPTED,{acceptedAt:2});
ledger.transition("d1",DISPATCH_STATUS.AWAITING_RESPONSE);

let now=1000;
const persistence=new MemoryStore();
const first=new ParkedResponseStore({store:persistence,maxEntries:2,ttlMs:5000,now:()=>now});
await first.init();
assert.equal((await first.park("d1",{dispatchId:"d1",conversationIdentity:identity,text:"reply"})).stored,true);
assert.equal((await first.park("d2",{dispatchId:"d2",text:"second"})).stored,true);
const full=await first.park("d3",{dispatchId:"d3",text:"third"});
assert.equal(full.stored,false);
assert.equal(full.reason,"STORE_FULL");
assert.equal(full.pause,true);
assert.equal(await first.size(),2);

const restarted=new ParkedResponseStore({store:persistence,maxEntries:2,ttlMs:5000,now:()=>now});
await restarted.init();
assert.equal((await restarted.get("d1")).state,RECORD_STATE.PARKED);
const claimed=await restarted.claim("d1");
assert.equal(claimed.claimed,true);
assert.equal(claimed.record.state,RECORD_STATE.CLAIMED);

const afterClaimRestart=new ParkedResponseStore({store:persistence,maxEntries:2,ttlMs:5000,now:()=>now});
await afterClaimRestart.init();
assert.equal((await afterClaimRestart.get("d1")).state,RECORD_STATE.CLAIMED);
const ambiguous=await afterClaimRestart.reconcileClaimed("d1",ledger);
assert.equal(ambiguous.action,RECONCILE.PAUSE);
assert.equal(await afterClaimRestart.size(),2);

ledger.transition("d1",DISPATCH_STATUS.RESPONSE_COMMITTED,{completedAt:3});
const cleared=await afterClaimRestart.reconcileClaimed("d1",ledger);
assert.equal(cleared.action,RECONCILE.CLEARED);
assert.equal(await afterClaimRestart.get("d1"),null);

now=7000;
const expiryStore=new ParkedResponseStore({store:persistence,maxEntries:3,ttlMs:1000,now:()=>now});
await expiryStore.init();
await expiryStore.park("expired",{text:"x"});
now=9001;
assert.equal(await expiryStore.get("expired"),null);

now=10000;
await expiryStore.park("claimed-expired",{text:"y"});
await expiryStore.claim("claimed-expired");
now=20000;
assert.equal((await expiryStore.get("claimed-expired")).state,RECORD_STATE.CLAIMED);

const concurrentPersistence=new MemoryStore();
const concurrent=new ParkedResponseStore({store:concurrentPersistence,maxEntries:4,ttlMs:5000,now:()=>1});
await concurrent.init();
const results=await Promise.all([
  concurrent.park("a",{text:"a"}),
  concurrent.park("b",{text:"b"}),
  concurrent.park("c",{text:"c"})
]);
assert.equal(results.filter(x=>x.stored).length,3);
assert.equal(await concurrent.size(),3);
const concurrentReload=new ParkedResponseStore({store:concurrentPersistence,maxEntries:4,ttlMs:5000,now:()=>1});
await concurrentReload.init();
assert.ok(await concurrentReload.get("a"));
assert.ok(await concurrentReload.get("b"));
assert.ok(await concurrentReload.get("c"));

console.log("round8-backend: PASS");
