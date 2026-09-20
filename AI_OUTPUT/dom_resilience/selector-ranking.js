export const RANK = Object.freeze({ EXACT_SEMANTIC:0, ACCESSIBLE_EXACT:1, STRUCTURAL:2, BROAD_GENERIC:3 });
export const HEALTH = Object.freeze({ PASS:'PASS', DEGRADED:'DEGRADED', FAIL:'FAIL', UNKNOWN:'UNKNOWN', UNSUPPORTED:'UNSUPPORTED' });

function validRank(rank){return Number.isInteger(rank)&&rank>=RANK.EXACT_SEMANTIC&&rank<=RANK.BROAD_GENERIC;}
function validateContract(c){
  if(!c||typeof c!=='object') throw new TypeError('selector contract must be an object.');
  if(!String(c.id||'').trim()) throw new TypeError('selector contract id required.');
  if(!String(c.selector||'').trim()) throw new TypeError('selector required.');
  if(!validRank(c.rank)) throw new TypeError('selector rank must be 0..3.');
  return c;
}
export function isUsableNode(node,host){
  if(!node) return false;
  if(typeof node.isConnected==='boolean'&&!node.isConnected) return false;
  const rect=typeof node.getBoundingClientRect==='function'?node.getBoundingClientRect():(host?.rectFor?.(node)||{width:1,height:1});
  if(!rect||rect.width<=0||rect.height<=0) return false;
  const style=host?.styleFor?.(node)||{visibility:'visible',display:'block'};
  if(style.visibility==='hidden'||style.display==='none') return false;
  if(node.hasAttribute?.('hidden')) return false;
  return true;
}
export function isEnabledControl(node){
  if(!node) return false;
  if(node.disabled===true) return false;
  return node.getAttribute?.('aria-disabled')!=='true';
}
export function evaluateContracts(contracts,host,{requireEnabled=false}={}){
  if(!Array.isArray(contracts)) throw new TypeError('contracts must be an array.');
  const ordered=[...contracts].map(validateContract).sort((a,b)=>a.rank-b.rank||String(a.id).localeCompare(String(b.id)));
  return ordered.map(contract=>{
    let nodes=[];
    try{nodes=Array.from(host.queryAll(contract.selector)||[]);}catch(err){return {id:contract.id,rank:contract.rank,state:HEALTH.FAIL,reason:'selector-threw:'+String(err?.message||'error').slice(0,120),matchCount:0,usableCount:0,nodeConnected:false,nodes:[]};}
    const usable=nodes.filter(node=>isUsableNode(node,host)&&(!(requireEnabled||contract.requiresEnabled)||isEnabledControl(node)));
    let state=HEALTH.FAIL,reason='no-usable-match';
    if(contract.rank<=RANK.ACCESSIBLE_EXACT&&usable.length===1){state=HEALTH.PASS;reason='unique-trusted';}
    else if(contract.rank===RANK.STRUCTURAL&&usable.length===1){state=HEALTH.DEGRADED;reason='unique-structural';}
    else if(contract.rank<=RANK.STRUCTURAL&&usable.length>1){state=HEALTH.DEGRADED;reason='ambiguous-match';}
    else if(contract.rank===RANK.BROAD_GENERIC&&usable.length>0){state=HEALTH.FAIL;reason='broad-generic-telemetry-only';}
    return {id:contract.id,rank:contract.rank,state,reason,matchCount:nodes.length,usableCount:usable.length,nodeConnected:Boolean(usable[0]&&usable[0].isConnected!==false),nodes:usable};
  });
}
export function resolveActionAuthority(results){
  const trusted=results.filter(r=>r.state===HEALTH.PASS&&r.rank<=RANK.ACCESSIBLE_EXACT&&r.usableCount===1);
  if(!trusted.length) return Object.freeze({state:HEALTH.FAIL,selectorId:null,matchCount:0,reason:'NO_TRUSTED_AUTHORITY',node:null,nodeConnected:false});
  const distinct=[];
  for(const r of trusted){const node=r.nodes[0];if(!distinct.includes(node)) distinct.push(node);}
  if(distinct.length!==1) return Object.freeze({state:HEALTH.FAIL,selectorId:null,matchCount:distinct.length,reason:'CONTRACT_DISAGREEMENT',node:null,nodeConnected:false});
  const node=distinct[0];
  const supporting=trusted.filter(r=>r.nodes[0]===node).map(r=>r.id);
  return Object.freeze({state:HEALTH.PASS,selectorId:supporting[0],supportingSelectorIds:Object.freeze(supporting),matchCount:1,reason:'TRUSTED_SELECTORS_AGREE',node,nodeConnected:node?.isConnected!==false});
}
export function summarizeAuthority(authority){return Object.freeze({state:authority?.state||HEALTH.FAIL,selectorId:authority?.selectorId||null,matchCount:Number(authority?.matchCount)||0,reason:String(authority?.reason||'UNKNOWN'),nodeConnected:Boolean(authority?.nodeConnected)});}
export function canAuthorizeAction(authority){return authority?.state===HEALTH.PASS&&authority.matchCount===1&&authority.nodeConnected===true&&Boolean(authority.node);}
