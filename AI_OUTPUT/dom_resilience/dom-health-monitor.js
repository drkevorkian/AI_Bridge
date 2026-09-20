export const PROBES=Object.freeze(['composer','send','stop','response','upload','new_chat','limit_state','conversation_identity']);
const SAFE_STATES=new Set(['PASS','DEGRADED','FAIL','UNKNOWN','UNSUPPORTED']);
function safeProbeName(v){const n=String(v||'');return PROBES.includes(n)?n:null;}
function sanitizeResult(name,value){
  const v=value&&typeof value==='object'?value:{};
  const state=SAFE_STATES.has(v.state)?v.state:'UNKNOWN';
  return Object.freeze({name,policy:String(v.policy||''),state,selectorId:v.selectorId==null?null:String(v.selectorId).slice(0,120),rank:Number.isInteger(v.rank)?v.rank:null,matchCount:Number.isInteger(v.matchCount)?Math.max(0,v.matchCount):0,reason:String(v.reason||'UNKNOWN').slice(0,160),nodeConnected:Boolean(v.nodeConnected)});
}
export class DomHealthMonitor{
  constructor({runProbe,emit,debounceMs=200,setTimer=setTimeout,clearTimer=clearTimeout,contextClassifier}={}){
    if(typeof runProbe!=='function') throw new TypeError('runProbe is required.');
    this.runProbe=runProbe;this.emit=typeof emit==='function'?emit:()=>{};this.debounceMs=Math.max(50,Math.min(1000,Number(debounceMs)||200));this.setTimer=setTimer;this.clearTimer=clearTimer;this.contextClassifier=typeof contextClassifier==='function'?contextClassifier:()=>null;this.dirty=new Set(PROBES);this.timer=null;this.visible=true;this.disposed=false;
  }
  markDirty(...names){if(this.disposed)return;for(const raw of names.flat()){const n=safeProbeName(raw);if(n)this.dirty.add(n);}this.schedule();}
  classifyMutations(records=[]){
    const dirtied=new Set();
    for(const r of records){if(!r||typeof r!=='object')continue;const ctx=this.contextClassifier(r.target)||'unknown';
      if(r.type==='characterData'){if(ctx==='response')dirtied.add('response');else if(['provider-notice','composer-status'].includes(ctx))dirtied.add('limit_state');else {dirtied.add('response');dirtied.add('limit_state');}continue;}
      if(r.type==='attributes'){const a=String(r.attributeName||'');if(['disabled','aria-disabled','data-state'].includes(a)){['composer','send','stop','new_chat'].forEach(x=>dirtied.add(x));dirtied.add('limit_state');}else if(a==='contenteditable')dirtied.add('composer');else if(['aria-label','title','class','data-testid','hidden'].includes(a)){['composer','send','stop','new_chat','upload','limit_state'].forEach(x=>dirtied.add(x));}continue;}
      if(r.type==='childList'){if(ctx==='response')dirtied.add('response');else if(ctx==='provider-notice')dirtied.add('limit_state');else PROBES.forEach(x=>dirtied.add(x));}
    }
    this.markDirty([...dirtied]);return [...dirtied];
  }
  routeChanged(){this.markDirty('conversation_identity','new_chat','limit_state','composer','send','stop','response');}
  schedule(){if(this.disposed||!this.visible||this.timer||!this.dirty.size)return;this.timer=this.setTimer(()=>{this.timer=null;this.flush().catch(e=>this.emit({type:'AI_BRIDGE_DOM_HEALTH_ERROR',message:String(e?.message||e).slice(0,160)}));},this.debounceMs);}
  async flush(){if(this.disposed||!this.visible)return[];const pending=[...this.dirty];this.dirty.clear();const results=[];for(const name of pending){try{results.push(sanitizeResult(name,await this.runProbe(name)));}catch(e){results.push(Object.freeze({name,policy:'',state:'FAIL',selectorId:null,rank:null,matchCount:0,reason:'PROBE_ERROR:'+String(e?.message||e).slice(0,120),nodeConnected:false}));}}this.emit({type:'AI_BRIDGE_DOM_HEALTH',results});if(this.dirty.size)this.schedule();return results;}
  setVisible(v){this.visible=Boolean(v);if(this.visible)this.schedule();else if(this.timer){this.clearTimer(this.timer);this.timer=null;}}
  dispose(){this.disposed=true;this.dirty.clear();if(this.timer)this.clearTimer(this.timer);this.timer=null;}
}
export const OBSERVER_OPTIONS=Object.freeze({subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:Object.freeze(['disabled','aria-disabled','aria-label','title','hidden','class','data-testid','data-state','contenteditable'])});
