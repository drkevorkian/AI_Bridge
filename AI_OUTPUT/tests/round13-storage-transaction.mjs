import assert from "node:assert/strict";
import parkedModule from "../thread_rollover/parked-response-store.js";
const {RECORD_STATE,STORE_ERROR_CODE,ParkedResponseStoreError,ParkedResponseStore}=parkedModule;

class MemoryStore{
  constructor(){this.data={};this.failNextSave=false;}
  async load(key){return structuredClone(this.data[key]??null);}
  async save(key,value){if(this.failNextSave){this.failNextSave=false;throw new Error("save failed");}this.data[key]=structuredClone(value);}
}
async function expectMutationFailure(fn){
  let error=null;try{await fn();}catch(e){error=e;}
  assert.ok(error instanceof ParkedResponseStoreError);
  assert.equal(error.code,STORE_ERROR_CODE.MUTATION_PERSIST_FAILED);
}
const persistence=new MemoryStore();
let now=1;
const store=new ParkedResponseStore({store:persistence,key:"k",maxEntries:8,maxBytes:4096,maxTotalBytes:16384,ttlMs:1000,now:()=>now});
await store.init();

persistence.failNextSave=true;
await expectMutationFailure(()=>store.park("p",{text:"park"}));
assert.equal(await store.get("p"),null);
assert.deepEqual(persistence.data.k?.records??[],[]);

await store.park("p",{text:"park"});
persistence.failNextSave=true;
await expectMutationFailure(()=>store.claim("p"));
assert.equal((await store.get("p")).state,RECORD_STATE.PARKED);

await store.claim("p");
persistence.failNextSave=true;
await expectMutationFailure(()=>store.release("p"));
assert.equal((await store.get("p")).state,RECORD_STATE.CLAIMED);

persistence.failNextSave=true;
await expectMutationFailure(()=>store.finalize("p"));
assert.ok(await store.get("p"));

const ledger={get:()=>({status:"RESPONSE_COMMITTED"})};
persistence.failNextSave=true;
await expectMutationFailure(()=>store.reconcileClaimed("p",ledger));
assert.equal((await store.get("p")).state,RECORD_STATE.CLAIMED);

await store.finalize("p");
await store.park("expired",{text:"old"});
now=2000;
persistence.failNextSave=true;
await expectMutationFailure(()=>store.size());
assert.ok(store.records.has("expired"));
assert.ok((persistence.data.k?.records??[]).some(r=>r.dispatchId==="expired"));

assert.equal(await store.size(),0);
assert.equal(store.records.has("expired"),false);
assert.equal((persistence.data.k?.records??[]).some(r=>r.dispatchId==="expired"),false);

console.log("round13-storage-transaction: PASS");
