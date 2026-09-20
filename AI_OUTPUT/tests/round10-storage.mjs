import assert from "node:assert/strict";
import parkedModule from "../thread_rollover/parked-response-store.js";
const {RECORD_STATE,RECONCILE,ParkedResponseStore}=parkedModule;

class MemoryStore{
  constructor(seed={},failSave=false){this.data=structuredClone(seed);this.failSave=failSave;}
  async load(key){return structuredClone(this.data[key]??null);}
  async save(key,value){if(this.failSave)throw new Error("save fail");this.data[key]=structuredClone(value);}
}
const rec=(id,value,state="PARKED",parkedAt=1,expiresAt=100,claimedAt=null)=>({dispatchId:id,state,envelope:{text:value},parkedAt,expiresAt,claimedAt});

let store=new ParkedResponseStore({store:new MemoryStore({k:{records:[rec("a","a"),rec("b","b"),rec("c","c")]}}),key:"k",maxEntries:2,maxBytes:1024,maxTotalBytes:4096,now:()=>10});
await assert.rejects(()=>store.init(),/maxEntries/);
assert.equal(store.initialized,false);
await assert.rejects(()=>store.size(),/init/);

store=new ParkedResponseStore({store:new MemoryStore({k:{records:[rec("a","x".repeat(700)),rec("b","y".repeat(700))]}}),key:"k",maxEntries:3,maxBytes:1024,maxTotalBytes:1200,now:()=>10});
await assert.rejects(()=>store.init(),/maxTotalBytes/);
assert.equal(store.initialized,false);

const persistence=new MemoryStore();
store=new ParkedResponseStore({store:persistence,key:"k",maxEntries:3,maxBytes:1024,maxTotalBytes:900,now:()=>10});
await store.init();
assert.equal((await store.park("a",{text:"x".repeat(300)})).stored,true);
const aggregateReject=await store.park("b",{text:"y".repeat(700)});
assert.equal(aggregateReject.reason,"STORE_TOTAL_BYTES_EXCEEDED");
assert.equal(aggregateReject.pause,true);
assert.ok(await store.get("a"));
assert.equal(await store.get("b"),null);

const claimedPersistence=new MemoryStore();
let now=10;
store=new ParkedResponseStore({store:claimedPersistence,key:"k",maxEntries:2,maxBytes:1024,maxTotalBytes:4096,ttlMs:1000,now:()=>now});
await store.init();
await store.park("d",{text:"reply"});
await store.claim("d");
now=2000;
assert.equal(await store.release("d"),false);
assert.equal((await store.get("d")).state,RECORD_STATE.CLAIMED);
assert.equal((await store.reconcileClaimed("d",{get:()=>({status:"AWAITING_RESPONSE"})})).action,RECONCILE.PAUSE);

const seed={k:{records:[rec("expired","x","PARKED",1,2,null)]}};
store=new ParkedResponseStore({store:new MemoryStore(seed,true),key:"k",maxEntries:2,maxBytes:1024,maxTotalBytes:4096,now:()=>10});
await assert.rejects(()=>store.init(),/save fail/);
assert.equal(store.initialized,false);
assert.equal(store.records.size,0);
await assert.rejects(()=>store.get("expired"),/init/);

const goodPersistence=new MemoryStore(seed,false);
store=new ParkedResponseStore({store:goodPersistence,key:"k",maxEntries:2,maxBytes:1024,maxTotalBytes:4096,now:()=>10});
await store.init();
assert.equal(await store.size(),0);

console.log("round10-storage: PASS");
