import assert from "node:assert/strict";

await import("../dom-resilience.js");
const api=globalThis.AIBridgeDomResilience;
assert.ok(api,"DOM resilience API must be installed");

function node({disabled=false,visible=true}={}){
  return {
    disabled,
    isConnected:true,
    getAttribute(name){return name==="aria-disabled"&&disabled?"true":null;},
    hasAttribute(){return false;},
    getBoundingClientRect(){return visible?{width:100,height:30}:{width:0,height:0};}
  };
}
const style=()=>({visibility:"visible",display:"block"});

assert.equal(api.providerFromHost("chatgpt.com"),"chatgpt");
assert.equal(api.providerFromHost("grok.com"),"grok");
assert.equal(api.providerFromHost("example.com"),null);

const composer=node();
const sendDisabled=node({disabled:true});
const response=node();
const queryAll=selector=>{
  if(selector==="#prompt-textarea") return [composer];
  if(selector==="button[data-testid='send-button']") return [sendDisabled];
  if(selector==="[data-message-author-role='assistant'] .markdown") return [response];
  return [];
};
const health=api.healthSnapshot("chatgpt",queryAll,style);
assert.equal(health.composer.state,"PASS");
assert.equal(health.send.state,"FAIL","authority remains fail-closed when no actionable send exists");
assert.equal(health.response.state,"PASS");

const evaluation=api.evaluate("chatgpt","send",queryAll,style);
assert.equal(evaluation[0].state,"DEGRADED");
assert.equal(evaluation[0].reason,"visible-not-actionable");

const actionable=node();
const ready=api.authority("chatgpt","send",selector=>selector==="button[data-testid='send-button']"?[actionable]:[],style);
assert.equal(ready.state,"PASS");
assert.equal(ready.selectorId,"chatgpt-send-testid");

console.log("AI Bridge DOM resilience contracts: OK");
