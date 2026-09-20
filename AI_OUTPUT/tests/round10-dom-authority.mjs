import assert from 'node:assert/strict';
import {evaluateContracts,resolveActionAuthority,canAuthorizeAction,RANK,HEALTH} from '../dom_resilience/selector-ranking.js';
import {DomHealthMonitor,PROBES} from '../dom_resilience/dom-health-monitor.js';
import {PROVIDER_CONTRACTS,getProviderContracts} from '../dom_resilience/provider-dom-contracts.js';
import {formatPauseReason} from '../integration/pause-reasons.js';
const node=()=>({isConnected:true,disabled:false,getBoundingClientRect:()=>({width:10,height:10}),getAttribute:()=>null,hasAttribute:()=>false});
const a=node(),b=node();
const contracts=[{id:'a',selector:'#a',rank:RANK.EXACT_SEMANTIC},{id:'b',selector:'#b',rank:RANK.ACCESSIBLE_EXACT}];
let host={queryAll:s=>s==='#a'?[a]:[a],styleFor:()=>({visibility:'visible',display:'block'})};
let auth=resolveActionAuthority(evaluateContracts(contracts,host));assert.equal(auth.state,HEALTH.PASS);assert.equal(canAuthorizeAction(auth),true);
host={queryAll:s=>s==='#a'?[a]:[b],styleFor:()=>({visibility:'visible',display:'block'})};auth=resolveActionAuthority(evaluateContracts(contracts,host));assert.equal(auth.reason,'CONTRACT_DISAGREEMENT');assert.equal(canAuthorizeAction(auth),false);
const structural=resolveActionAuthority(evaluateContracts([{id:'s',selector:'button',rank:RANK.STRUCTURAL}],{queryAll:()=>[a],styleFor:()=>({visibility:'visible',display:'block'})}));assert.equal(structural.state,HEALTH.FAIL);
assert.equal(getProviderContracts('chatgpt'),PROVIDER_CONTRACTS.chatgpt);
assert.equal(getProviderContracts('unknown'),null);
for(const p of ['chatgpt','grok','claude','gemini','copilot']){
  assert.ok(PROVIDER_CONTRACTS[p],p);
  for(const c of ['composer','send','stop','response']) assert.ok(Array.isArray(PROVIDER_CONTRACTS[p][c]),p+'.'+c);
  assert.ok(PROVIDER_CONTRACTS[p].send.length>0,p+'.send');
  for(const item of PROVIDER_CONTRACTS[p].send){
    assert.notEqual(item.rank,RANK.BROAD_GENERIC,p+' broad selector must not authorize send');
    assert.equal(item.requiresEnabled,true,p+' send authority must require enabled control');
  }
}
assert.ok(PROBES.includes('send'));assert.ok(PROBES.includes('response'));
const emitted=[];const m=new DomHealthMonitor({runProbe:async()=>({policy:'ACTION_AUTHORITY',state:'PASS',selectorId:'x',rank:0,matchCount:1,reason:'OK',nodeConnected:true,rawHtml:'SECRET'}),emit:x=>emitted.push(x),setTimer:()=>1,clearTimer:()=>{}});m.dirty=new Set(['send']);const out=await m.flush();assert.equal(out[0].rawHtml,undefined);assert.equal(out[0].selectorId,'x');
const dirtied=m.classifyMutations([{type:'attributes',attributeName:'aria-disabled',target:{}}]);assert.ok(dirtied.includes('composer'));assert.ok(dirtied.includes('send'));assert.ok(dirtied.includes('stop'));assert.ok(dirtied.includes('new_chat'));assert.ok(dirtied.includes('limit_state'));assert.ok(!dirtied.includes('response'));
const respMonitor=new DomHealthMonitor({runProbe:async()=>({state:'PASS'}),contextClassifier:()=> 'response',setTimer:()=>1,clearTimer:()=>{}});respMonitor.dirty.clear();const d2=respMonitor.classifyMutations([{type:'characterData',target:{}}]);assert.deepEqual(d2,['response']);
assert.match(formatPauseReason({code:'DOM_SEND_UNAVAILABLE',side:'B',provider:'ChatGPT'}),/No message was sent/);
console.log('round10-dom-authority: PASS');
