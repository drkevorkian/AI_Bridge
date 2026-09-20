import assert from "node:assert/strict";
import parkedModule from "../thread_rollover/parked-response-store.js";
const {RECORD_STATE,RELEASE_REASON,STORE_ERROR_CODE,ParkedResponseStoreError,ParkedResponseStore}=parkedModule;

class MemoryStore{
  constructor(seed={},options={}){this.data=structuredClone(seed);this.failLoad=options.failLoad===true;this.failSave=options.failSave===true;}
  async load(key){if(this.failLoad)throw new Error("load failed");return structuredClone(this.data[key]??null);}
  async save(key,value){if(this.failSave)throw new Error("save failed");this.data[key]=structuredClone(value);}
}
const rec=(id,value,state="PARKED",parkedAt=1,expiresAt=100,claimedAt=null)=>({dispatchId:id,state,envelope:{text:value},parkedAt,expiresAt,claimedAt});

let store=new ParkedResponseStore({store:new MemoryStore(),maxBytes:1024,maxTotalBytes:4096,ttlMs:1000,now:()=>10});
await store.init();
let result=await store.release("missing");
assert.deepEqual({released:result.released,reason:result.reason,pause:result.pause},{released:false,reason:RELEASE_REASON.NOT_FOUND,pause:false});
await store.park("p",{text:"parked"});
result=await store.release("p");
assert.equal(result.reason,RELEASE_REASON.NOT_CLAIMED);
assert.equal(result.pause,false);
await store.claim("p");
result=await store.release("p");
assert.equal(result.released,true);
assert.equal(result.reason,RELEASE_REASON.RELEASED);
assert.equal((await store.get("p")).state,RECORD_STATE.PARKED);

let now=10;
store=new ParkedResponseStore({store:new MemoryStore(),maxBytes:1024,maxTotalBytes:4096,ttlMs:1000,now:()=>now});
await store.init();
await store.park("expired",{text:"reply"});
await store.claim("expired");
now=2000;
result=await store.release("expired");
assert.equal(result.released,false);
assert.equal(result.reason,RELEASE_REASON.CLAIM_EXPIRED_RECONCILIATION_REQUIRED);
assert.equal(result.pause,true);
assert.equal((await store.get("expired")).state,RECORD_STATE.CLAIMED);

async function expectCode(factory,code){
  let error=null;
  try{await factory();}catch(e){error=e;}
  assert.ok(error instanceof ParkedResponseStoreError);
  assert.equal(error.code,code);
}

await expectCode(()=>new ParkedResponseStore({store:new MemoryStore({}, {failLoad:true}),maxBytes:1024,maxTotalBytes:4096}).init(),STORE_ERROR_CODE.RECOVERY_LOAD_FAILED);
await expectCode(()=>new ParkedResponseStore({store:new MemoryStore({k:{records:[rec("a","a"),rec("b","b")]}}),key:"k",maxEntries:1,maxBytes:1024,maxTotalBytes:4096,now:()=>10}).init(),STORE_ERROR_CODE.RECOVERY_ENTRY_LIMIT_EXCEEDED);
await expectCode(()=>new ParkedResponseStore({store:new MemoryStore({k:{records:[rec("dup","a"),rec("dup","b")]}}),key:"k",maxEntries:3,maxBytes:1024,maxTotalBytes:4096,now:()=>10}).init(),STORE_ERROR_CODE.RECOVERY_DUPLICATE_DISPATCH);
await expectCode(()=>new ParkedResponseStore({store:new MemoryStore({k:{records:[{bad:true}]}}),key:"k",maxEntries:3,maxBytes:1024,maxTotalBytes:4096,now:()=>10}).init(),STORE_ERROR_CODE.RECOVERY_SCHEMA_INVALID);
await expectCode(()=>new ParkedResponseStore({store:new MemoryStore({k:{records:[rec("a","x".repeat(700)),rec("b","y".repeat(700))]}}),key:"k",maxEntries:3,maxBytes:1024,maxTotalBytes:1200,now:()=>10}).init(),STORE_ERROR_CODE.RECOVERY_TOTAL_BYTES_EXCEEDED);
const persistFail=new ParkedResponseStore({store:new MemoryStore({k:{records:[rec("expired","x","PARKED",1,2,null)]}}, {failSave:true}),key:"k",maxEntries:3,maxBytes:1024,maxTotalBytes:4096,now:()=>10});
await expectCode(()=>persistFail.init(),STORE_ERROR_CODE.RECOVERY_PERSIST_FAILED);
assert.equal(persistFail.initialized,false);
assert.equal(persistFail.records.size,0);

console.log("round12-storage-api: PASS");
