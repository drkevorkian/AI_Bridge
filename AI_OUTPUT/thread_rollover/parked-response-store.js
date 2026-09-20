"use strict";
function text(v,n){const s=String(v??"").trim();if(!s)throw new TypeError(`${n} must be a non-empty string.`);return s;}
function integer(v,n,min){const x=Number(v);if(!Number.isInteger(x)||x<min)throw new TypeError(`${n} must be an integer >= ${min}.`);return x;}
class ParkedResponseStore{
 constructor({maxEntries=8,maxBytes=262144,ttlMs=15000,now=()=>Date.now()}={}){this.maxEntries=integer(maxEntries,"maxEntries",1);this.maxBytes=integer(maxBytes,"maxBytes",1024);this.ttlMs=integer(ttlMs,"ttlMs",1000);if(typeof now!=="function")throw new TypeError("now must be a function.");this.now=now;this.records=new Map();}
 prune(){const t=this.now();for(const[id,r]of this.records)if(r.expiresAt<=t)this.records.delete(id);}
 park(dispatchId,envelope){this.prune();const id=text(dispatchId,"dispatchId");const payload=JSON.stringify(envelope??null);const bytes=typeof Buffer!=="undefined"?Buffer.byteLength(payload,"utf8"):new TextEncoder().encode(payload).length;if(bytes>this.maxBytes)throw new Error("parked response exceeds size limit.");if(this.records.has(id))return Object.freeze({stored:false,reason:"ALREADY_PARKED"});while(this.records.size>=this.maxEntries)this.records.delete(this.records.keys().next().value);const record=Object.freeze({dispatchId:id,envelope:JSON.parse(payload),parkedAt:this.now(),expiresAt:this.now()+this.ttlMs});this.records.set(id,record);return Object.freeze({stored:true,record});}
 take(dispatchId){this.prune();const id=String(dispatchId||"");const r=this.records.get(id)||null;if(r)this.records.delete(id);return r;}
 drop(dispatchId){return this.records.delete(String(dispatchId||""));}
 get(dispatchId){this.prune();return this.records.get(String(dispatchId||""))||null;}
 size(){this.prune();return this.records.size;}
}
module.exports={ParkedResponseStore};
