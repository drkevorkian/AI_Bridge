"use strict";
class BootstrapTimeoutError extends Error{constructor(stage,timeoutMs){super(`Bootstrap stage ${stage} exceeded ${timeoutMs} ms.`);this.name="BootstrapTimeoutError";this.stage=stage;this.timeoutMs=timeoutMs;}}
function positiveTimeout(value,fallback){const n=Number(value);return Number.isFinite(n)&&n>0?Math.floor(n):fallback;}
async function withTimeout(stage,task,timeoutMs){const ms=positiveTimeout(timeoutMs,5000);let timer;try{return await Promise.race([Promise.resolve().then(task),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new BootstrapTimeoutError(stage,ms)),ms);})]);}finally{if(timer)clearTimeout(timer);}}
class BoundedBootstrap{
 constructor({storageTimeoutMs=3000,validationTimeoutMs=3000,reconnectTimeoutMs=8000}={}){this.timeouts=Object.freeze({storage:positiveTimeout(storageTimeoutMs,3000),validation:positiveTimeout(validationTimeoutMs,3000),reconnect:positiveTimeout(reconnectTimeoutMs,8000)});}
 async initialize({defaults,readPersistedState,validateAndMigrate,reconnectProviders}={}){
  const safeDefaults=typeof defaults==="function"?defaults():{...(defaults||{})},diagnostics=[];let persisted=null,state=safeDefaults;
  try{persisted=await withTimeout("storage",()=>readPersistedState?.(),this.timeouts.storage);}catch(error){diagnostics.push({stage:"storage",level:"error",message:error.message});}
  if(persisted!=null){try{state=await withTimeout("validation",()=>validateAndMigrate?validateAndMigrate(persisted,safeDefaults):persisted,this.timeouts.validation);}catch(error){diagnostics.push({stage:"validation",level:"error",message:error.message});state=safeDefaults;}}
  const controlPlane=Object.freeze({ready:true,state,diagnostics:[...diagnostics]});
  const providerRecovery=(async()=>{try{const result=await withTimeout("provider-reconnect",()=>reconnectProviders?.(state),this.timeouts.reconnect);return {ok:true,result:result??null};}catch(error){return {ok:false,error:error.message};}})();
  return {controlPlane,providerRecovery};
 }
}
module.exports={BootstrapTimeoutError,withTimeout,BoundedBootstrap};
