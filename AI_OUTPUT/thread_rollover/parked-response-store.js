"use strict";

const RECORD_STATE=Object.freeze({PARKED:"PARKED",CLAIMED:"CLAIMED"});
const RECONCILE=Object.freeze({CLEARED:"CLEARED",PAUSE:"PAUSE",NONE:"NONE"});
const TERMINAL_DISPATCH=new Set(["RESPONSE_COMMITTED","FAILED"]);

function text(value,name){const s=String(value??"").trim();if(!s)throw new TypeError(`${name} must be a non-empty string.`);return s;}
function integer(value,name,min){const n=Number(value);if(!Number.isInteger(n)||n<min)throw new TypeError(`${name} must be an integer >= ${min}.`);return n;}
function byteLength(value){const s=JSON.stringify(value);return typeof Buffer!=="undefined"?Buffer.byteLength(s,"utf8"):new TextEncoder().encode(s).length;}
function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}

class ParkedResponseStore{
  constructor({store,key="aiBridgeParkedResponses",maxEntries=8,maxBytes=262144,ttlMs=15000,now=()=>Date.now()}={}){
    if(!store||typeof store.load!=="function"||typeof store.save!=="function")throw new TypeError("store with async load/save is required.");
    if(typeof now!=="function")throw new TypeError("now must be a function.");
    this.store=store;
    this.key=text(key,"key");
    this.maxEntries=integer(maxEntries,"maxEntries",1);
    this.maxBytes=integer(maxBytes,"maxBytes",1024);
    this.ttlMs=integer(ttlMs,"ttlMs",1000);
    this.now=now;
    this.records=new Map();
    this.initialized=false;
    this._queue=Promise.resolve();
  }

  async init(){
    return this._serialize(async()=>{
      const raw=await this.store.load(this.key);
      this.records.clear();
      const items=Array.isArray(raw?.records)?raw.records:[];
      for(const item of items){
        const record=this._sanitizeRecord(item);
        if(this.records.has(record.dispatchId))throw new Error(`Duplicate persisted parked response: ${record.dispatchId}`);
        this.records.set(record.dispatchId,record);
      }
      this.initialized=true;
      const changed=this._pruneExpiredParked();
      if(changed)await this._persist();
      return this.snapshot();
    },false);
  }

  async park(dispatchId,envelope){
    return this._serialize(async()=>{
      this._requireInit();
      this._pruneExpiredParked();
      const id=text(dispatchId,"dispatchId");
      if(this.records.has(id))return Object.freeze({stored:false,reason:"ALREADY_PARKED",pause:false});
      if(this.records.size>=this.maxEntries)return Object.freeze({stored:false,reason:"STORE_FULL",pause:true});
      const cleanEnvelope=clone(envelope??null);
      if(byteLength(cleanEnvelope)>this.maxBytes)return Object.freeze({stored:false,reason:"PAYLOAD_TOO_LARGE",pause:true});
      const parkedAt=this.now();
      const record=Object.freeze({dispatchId:id,state:RECORD_STATE.PARKED,envelope:cleanEnvelope,parkedAt,expiresAt:parkedAt+this.ttlMs,claimedAt:null});
      this.records.set(id,record);
      await this._persist();
      return Object.freeze({stored:true,reason:"PARKED",pause:false,record:clone(record)});
    });
  }

  async claim(dispatchId){
    return this._serialize(async()=>{
      this._requireInit();
      this._pruneExpiredParked();
      const id=String(dispatchId||"");
      const current=this.records.get(id);
      if(!current)return Object.freeze({claimed:false,reason:"NOT_FOUND",record:null});
      if(current.state===RECORD_STATE.CLAIMED)return Object.freeze({claimed:false,reason:"ALREADY_CLAIMED",record:clone(current)});
      const updated=Object.freeze({...current,state:RECORD_STATE.CLAIMED,claimedAt:this.now()});
      this.records.set(id,updated);
      await this._persist();
      return Object.freeze({claimed:true,reason:"CLAIMED",record:clone(updated)});
    });
  }

  async release(dispatchId){
    return this._serialize(async()=>{
      this._requireInit();
      const id=String(dispatchId||"");
      const current=this.records.get(id);
      if(!current)return false;
      if(current.state!==RECORD_STATE.CLAIMED)throw new Error("Only CLAIMED responses can be released.");
      if(current.expiresAt<=this.now()){this.records.delete(id);await this._persist();return false;}
      this.records.set(id,Object.freeze({...current,state:RECORD_STATE.PARKED,claimedAt:null}));
      await this._persist();
      return true;
    });
  }

  async finalize(dispatchId){
    return this._serialize(async()=>{
      this._requireInit();
      const removed=this.records.delete(String(dispatchId||""));
      if(removed)await this._persist();
      return removed;
    });
  }

  async drop(dispatchId){return this.finalize(dispatchId);}

  async get(dispatchId){
    return this._serialize(async()=>{
      this._requireInit();
      const changed=this._pruneExpiredParked();
      if(changed)await this._persist();
      return clone(this.records.get(String(dispatchId||""))||null);
    });
  }

  async size(){
    return this._serialize(async()=>{
      this._requireInit();
      const changed=this._pruneExpiredParked();
      if(changed)await this._persist();
      return this.records.size;
    });
  }

  async reconcileClaimed(dispatchId,ledger){
    return this._serialize(async()=>{
      this._requireInit();
      if(!ledger||typeof ledger.get!=="function")return Object.freeze({action:RECONCILE.PAUSE,reason:"LEDGER_UNAVAILABLE"});
      const id=String(dispatchId||"");
      const record=this.records.get(id);
      if(!record)return Object.freeze({action:RECONCILE.NONE,reason:"NOT_FOUND"});
      if(record.state!==RECORD_STATE.CLAIMED)return Object.freeze({action:RECONCILE.NONE,reason:"NOT_CLAIMED"});
      const dispatch=ledger.get(id);
      if(dispatch&&TERMINAL_DISPATCH.has(dispatch.status)){
        this.records.delete(id);
        await this._persist();
        return Object.freeze({action:RECONCILE.CLEARED,reason:dispatch.status});
      }
      return Object.freeze({action:RECONCILE.PAUSE,reason:dispatch?"CLAIM_OUTCOME_AMBIGUOUS":"DISPATCH_MISSING"});
    });
  }

  snapshot(){
    this._requireInit();
    return Object.freeze({records:[...this.records.values()].map(clone)});
  }

  _sanitizeRecord(raw){
    if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new TypeError("parked response record must be an object.");
    const dispatchId=text(raw.dispatchId,"dispatchId");
    const state=text(raw.state,"state").toUpperCase();
    if(!Object.values(RECORD_STATE).includes(state))throw new TypeError("parked response state is invalid.");
    const parkedAt=integer(raw.parkedAt,"parkedAt",0);
    const expiresAt=integer(raw.expiresAt,"expiresAt",0);
    if(expiresAt<parkedAt)throw new Error("expiresAt cannot precede parkedAt.");
    const claimedAt=raw.claimedAt==null?null:integer(raw.claimedAt,"claimedAt",0);
    if(state===RECORD_STATE.PARKED&&claimedAt!==null)throw new Error("PARKED response cannot have claimedAt.");
    if(state===RECORD_STATE.CLAIMED&&(claimedAt===null||claimedAt<parkedAt))throw new Error("CLAIMED response requires valid claimedAt.");
    const envelope=clone(raw.envelope??null);
    if(byteLength(envelope)>this.maxBytes)throw new Error("persisted parked response exceeds size limit.");
    return Object.freeze({dispatchId,state,envelope,parkedAt,expiresAt,claimedAt});
  }

  _pruneExpiredParked(){
    const now=this.now();
    let changed=false;
    for(const[id,record]of this.records){
      if(record.state===RECORD_STATE.PARKED&&record.expiresAt<=now){this.records.delete(id);changed=true;}
    }
    return changed;
  }

  async _persist(){await this.store.save(this.key,{records:[...this.records.values()].map(clone)});}
  _requireInit(){if(!this.initialized)throw new Error("ParkedResponseStore.init() must complete before use.");}

  _serialize(task,requireInitialized=true){
    const run=async()=>{if(requireInitialized)this._requireInit();return task();};
    const next=this._queue.catch(()=>undefined).then(run);
    this._queue=next.catch(()=>undefined);
    return next;
  }
}

module.exports={RECORD_STATE,RECONCILE,ParkedResponseStore};
