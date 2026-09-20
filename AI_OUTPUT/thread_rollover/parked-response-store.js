"use strict";

const RECORD_STATE=Object.freeze({PARKED:"PARKED",CLAIMED:"CLAIMED"});
const RECONCILE=Object.freeze({CLEARED:"CLEARED",PAUSE:"PAUSE",NONE:"NONE"});
const RELEASE_REASON=Object.freeze({RELEASED:"RELEASED",NOT_FOUND:"NOT_FOUND",NOT_CLAIMED:"NOT_CLAIMED",CLAIM_EXPIRED_RECONCILIATION_REQUIRED:"CLAIM_EXPIRED_RECONCILIATION_REQUIRED"});
const STORE_ERROR_CODE=Object.freeze({RECOVERY_LOAD_FAILED:"RECOVERY_LOAD_FAILED",RECOVERY_ENTRY_LIMIT_EXCEEDED:"RECOVERY_ENTRY_LIMIT_EXCEEDED",RECOVERY_TOTAL_BYTES_EXCEEDED:"RECOVERY_TOTAL_BYTES_EXCEEDED",RECOVERY_DUPLICATE_DISPATCH:"RECOVERY_DUPLICATE_DISPATCH",RECOVERY_SCHEMA_INVALID:"RECOVERY_SCHEMA_INVALID",RECOVERY_PERSIST_FAILED:"RECOVERY_PERSIST_FAILED"});
const TERMINAL_DISPATCH=new Set(["RESPONSE_COMMITTED","FAILED"]);

function text(value,name){const s=String(value??"").trim();if(!s)throw new TypeError(`${name} must be a non-empty string.`);return s;}
function integer(value,name,min){const n=Number(value);if(!Number.isInteger(n)||n<min)throw new TypeError(`${name} must be an integer >= ${min}.`);return n;}
function byteLength(value){const s=JSON.stringify(value);return typeof Buffer!=="undefined"?Buffer.byteLength(s,"utf8"):new TextEncoder().encode(s).length;}
function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}

class ParkedResponseStoreError extends Error{
  constructor(code,message,cause=null){super(String(message||code));this.name="ParkedResponseStoreError";this.code=text(code,"code");if(cause!=null)this.cause=cause;}
}

class ParkedResponseStore{
  constructor({store,key="aiBridgeParkedResponses",maxEntries=8,maxBytes=262144,maxTotalBytes=null,ttlMs=15000,now=()=>Date.now()}={}){
    if(!store||typeof store.load!=="function"||typeof store.save!=="function")throw new TypeError("store with async load/save is required.");
    if(typeof now!=="function")throw new TypeError("now must be a function.");
    this.store=store;
    this.key=text(key,"key");
    this.maxEntries=integer(maxEntries,"maxEntries",1);
    this.maxBytes=integer(maxBytes,"maxBytes",1024);
    this.maxTotalBytes=maxTotalBytes==null?this.maxBytes*this.maxEntries:integer(maxTotalBytes,"maxTotalBytes",1);
    this.ttlMs=integer(ttlMs,"ttlMs",1000);
    this.now=now;
    this.records=new Map();
    this.initialized=false;
    this._queue=Promise.resolve();
  }

  async init(){
    return this._serialize(async()=>{
      this.initialized=false;
      this.records.clear();
      let raw;
      try{raw=await this.store.load(this.key);}catch(error){throw new ParkedResponseStoreError(STORE_ERROR_CODE.RECOVERY_LOAD_FAILED,"Failed to load persisted parked-response state.",error);}
      const items=Array.isArray(raw?.records)?raw.records:[];
      if(items.length>this.maxEntries)throw new ParkedResponseStoreError(STORE_ERROR_CODE.RECOVERY_ENTRY_LIMIT_EXCEEDED,"Persisted parked-response count exceeds maxEntries.");
      const candidate=new Map();
      for(const item of items){
        let record;
        try{record=this._sanitizeRecord(item);}catch(error){throw new ParkedResponseStoreError(STORE_ERROR_CODE.RECOVERY_SCHEMA_INVALID,"Persisted parked-response record failed validation.",error);}
        if(candidate.has(record.dispatchId))throw new ParkedResponseStoreError(STORE_ERROR_CODE.RECOVERY_DUPLICATE_DISPATCH,`Duplicate persisted parked response: ${record.dispatchId}`);
        candidate.set(record.dispatchId,record);
      }
      const changed=this._pruneExpiredParked(candidate);
      if(!this._fitsAggregateBudget(candidate))throw new ParkedResponseStoreError(STORE_ERROR_CODE.RECOVERY_TOTAL_BYTES_EXCEEDED,"Persisted parked-response store exceeds maxTotalBytes.");
      if(changed){try{await this._persistMap(candidate);}catch(error){throw new ParkedResponseStoreError(STORE_ERROR_CODE.RECOVERY_PERSIST_FAILED,"Failed to persist recovered parked-response state.",error);}}
      this.records=candidate;
      this.initialized=true;
      return this.snapshot();
    },false).catch(error=>{
      this.records.clear();
      this.initialized=false;
      throw error;
    });
  }

  async park(dispatchId,envelope){
    return this._serialize(async()=>{
      const changed=this._pruneExpiredParked(this.records);
      if(changed)await this._persist();
      const id=text(dispatchId,"dispatchId");
      if(this.records.has(id))return Object.freeze({stored:false,reason:"ALREADY_PARKED",pause:false});
      if(this.records.size>=this.maxEntries)return Object.freeze({stored:false,reason:"STORE_FULL",pause:true});
      const cleanEnvelope=clone(envelope??null);
      if(byteLength(cleanEnvelope)>this.maxBytes)return Object.freeze({stored:false,reason:"PAYLOAD_TOO_LARGE",pause:true});
      const parkedAt=this.now();
      const record=Object.freeze({dispatchId:id,state:RECORD_STATE.PARKED,envelope:cleanEnvelope,parkedAt,expiresAt:parkedAt+this.ttlMs,claimedAt:null});
      const candidate=new Map(this.records);candidate.set(id,record);
      if(!this._fitsAggregateBudget(candidate))return Object.freeze({stored:false,reason:"STORE_TOTAL_BYTES_EXCEEDED",pause:true});
      this.records=candidate;
      await this._persist();
      return Object.freeze({stored:true,reason:"PARKED",pause:false,record:clone(record)});
    });
  }

  async claim(dispatchId){
    return this._serialize(async()=>{
      const changed=this._pruneExpiredParked(this.records);if(changed)await this._persist();
      const id=String(dispatchId||"");const current=this.records.get(id);
      if(!current)return Object.freeze({claimed:false,reason:"NOT_FOUND",record:null});
      if(current.state===RECORD_STATE.CLAIMED)return Object.freeze({claimed:false,reason:"ALREADY_CLAIMED",record:clone(current)});
      const updated=Object.freeze({...current,state:RECORD_STATE.CLAIMED,claimedAt:this.now()});
      const candidate=new Map(this.records);candidate.set(id,updated);this._assertAggregateBudget(candidate);
      this.records=candidate;await this._persist();
      return Object.freeze({claimed:true,reason:"CLAIMED",record:clone(updated)});
    });
  }

  async release(dispatchId){
    return this._serialize(async()=>{
      const id=String(dispatchId||"");const current=this.records.get(id);
      if(!current)return Object.freeze({released:false,reason:RELEASE_REASON.NOT_FOUND,pause:false,record:null});
      if(current.state!==RECORD_STATE.CLAIMED)return Object.freeze({released:false,reason:RELEASE_REASON.NOT_CLAIMED,pause:false,record:clone(current)});
      if(current.expiresAt<=this.now())return Object.freeze({released:false,reason:RELEASE_REASON.CLAIM_EXPIRED_RECONCILIATION_REQUIRED,pause:true,record:clone(current)});
      const updated=Object.freeze({...current,state:RECORD_STATE.PARKED,claimedAt:null});
      const candidate=new Map(this.records);candidate.set(id,updated);this._assertAggregateBudget(candidate);
      this.records=candidate;await this._persist();
      return Object.freeze({released:true,reason:RELEASE_REASON.RELEASED,pause:false,record:clone(updated)});
    });
  }

  async finalize(dispatchId){return this._serialize(async()=>{const removed=this.records.delete(String(dispatchId||""));if(removed)await this._persist();return removed;});}
  async drop(dispatchId){return this.finalize(dispatchId);}
  async get(dispatchId){return this._serialize(async()=>{const changed=this._pruneExpiredParked(this.records);if(changed)await this._persist();return clone(this.records.get(String(dispatchId||""))||null);});}
  async size(){return this._serialize(async()=>{const changed=this._pruneExpiredParked(this.records);if(changed)await this._persist();return this.records.size;});}

  async reconcileClaimed(dispatchId,ledger){
    return this._serialize(async()=>{
      if(!ledger||typeof ledger.get!=="function")return Object.freeze({action:RECONCILE.PAUSE,reason:"LEDGER_UNAVAILABLE"});
      const id=String(dispatchId||"");const record=this.records.get(id);
      if(!record)return Object.freeze({action:RECONCILE.NONE,reason:"NOT_FOUND"});
      if(record.state!==RECORD_STATE.CLAIMED)return Object.freeze({action:RECONCILE.NONE,reason:"NOT_CLAIMED"});
      const dispatch=ledger.get(id);
      if(dispatch&&TERMINAL_DISPATCH.has(dispatch.status)){this.records.delete(id);await this._persist();return Object.freeze({action:RECONCILE.CLEARED,reason:dispatch.status});}
      return Object.freeze({action:RECONCILE.PAUSE,reason:dispatch?"CLAIM_OUTCOME_AMBIGUOUS":"DISPATCH_MISSING"});
    });
  }

  snapshot(){this._requireInit();return Object.freeze({records:[...this.records.values()].map(clone)});}

  _sanitizeRecord(raw){
    if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new TypeError("parked response record must be an object.");
    const dispatchId=text(raw.dispatchId,"dispatchId");const state=text(raw.state,"state").toUpperCase();
    if(!Object.values(RECORD_STATE).includes(state))throw new TypeError("parked response state is invalid.");
    const parkedAt=integer(raw.parkedAt,"parkedAt",0);const expiresAt=integer(raw.expiresAt,"expiresAt",0);if(expiresAt<parkedAt)throw new Error("expiresAt cannot precede parkedAt.");
    const claimedAt=raw.claimedAt==null?null:integer(raw.claimedAt,"claimedAt",0);
    if(state===RECORD_STATE.PARKED&&claimedAt!==null)throw new Error("PARKED response cannot have claimedAt.");
    if(state===RECORD_STATE.CLAIMED&&(claimedAt===null||claimedAt<parkedAt))throw new Error("CLAIMED response requires valid claimedAt.");
    const envelope=clone(raw.envelope??null);if(byteLength(envelope)>this.maxBytes)throw new Error("persisted parked response exceeds size limit.");
    return Object.freeze({dispatchId,state,envelope,parkedAt,expiresAt,claimedAt});
  }

  _pruneExpiredParked(records){const now=this.now();let changed=false;for(const[id,record]of records){if(record.state===RECORD_STATE.PARKED&&record.expiresAt<=now){records.delete(id);changed=true;}}return changed;}
  _serializedPayload(records){return{records:[...records.values()].map(clone)};}
  _fitsAggregateBudget(records){return byteLength(this._serializedPayload(records))<=this.maxTotalBytes;}
  _assertAggregateBudget(records){if(records.size>this.maxEntries)throw new Error("Parked-response count exceeds maxEntries.");if(!this._fitsAggregateBudget(records))throw new Error("Persisted parked-response store exceeds maxTotalBytes.");}
  async _persistMap(records){this._assertAggregateBudget(records);await this.store.save(this.key,this._serializedPayload(records));}
  async _persist(){return this._persistMap(this.records);}
  _requireInit(){if(!this.initialized)throw new Error("ParkedResponseStore.init() must complete before use.");}
  _serialize(task,requireInitialized=true){const run=async()=>{if(requireInitialized)this._requireInit();return task();};const next=this._queue.catch(()=>undefined).then(run);this._queue=next.catch(()=>undefined);return next;}
}
module.exports={RECORD_STATE,RECONCILE,RELEASE_REASON,STORE_ERROR_CODE,ParkedResponseStoreError,ParkedResponseStore};
