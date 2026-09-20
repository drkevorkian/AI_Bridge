"use strict";
function nonEmptyString(value,name){const text=String(value??"").trim();if(!text)throw new TypeError(`${name} must be a non-empty string.`);return text;}
function sanitizeIdentity(identity){
  if(!identity||typeof identity!=="object"||Array.isArray(identity))throw new TypeError("conversation identity must be an object.");
  const provider=nonEmptyString(identity.provider,"identity.provider").toLowerCase();
  const kind=nonEmptyString(identity.kind,"identity.kind");
  const routeClass=nonEmptyString(identity.routeClass,"identity.routeClass");
  const threadKey=identity.threadKey==null?null:nonEmptyString(identity.threadKey,"identity.threadKey");
  const provisional=Boolean(identity.provisional);
  const writable=identity.writable===true;
  if(kind==="conversation"&&!threadKey)throw new TypeError("conversation identity requires threadKey.");
  if(kind!=="conversation"&&threadKey!==null&&kind!=="share")throw new TypeError(`${kind} identity cannot carry threadKey.`);
  if(kind==="share"&&writable)throw new TypeError("share identity cannot be writable.");
  if(kind==="surface"&&!provisional)throw new TypeError("surface identity must be provisional.");
  if(kind==="conversation"&&provisional)throw new TypeError("conversation identity cannot be provisional.");
  return Object.freeze({provider,kind,routeClass,threadKey,provisional,writable});
}
function identityKey(identity){const i=sanitizeIdentity(identity);return[i.provider,i.kind,i.routeClass,i.threadKey||"-",i.provisional?"p":"f",i.writable?"w":"r"].join("|");}
function sameIdentity(a,b){try{return identityKey(a)===identityKey(b);}catch(_){return false;}}
module.exports=Object.freeze({sanitizeIdentity,identityKey,sameIdentity});
