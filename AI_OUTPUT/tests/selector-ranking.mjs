import assert from "node:assert/strict";
import { RANK, HEALTH, evaluateContracts, pickAuthority, canAuthorizeAction } from "../dom_resilience/selector-ranking.js";

const node={ isConnected:true, disabled:false, getBoundingClientRect(){return{width:10,height:10};}, getAttribute(){return null;}, hasAttribute(){return false;} };
const host={ queryAll(selector){ return selector==="#send"?[node]:[]; }, styleFor(){return{visibility:"visible",display:"block"};} };
const results=evaluateContracts([{id:"send",selector:"#send",rank:RANK.EXACT_SEMANTIC,requiresEnabled:true}],host);
assert.equal(results[0].state,HEALTH.PASS);
const authority=pickAuthority(results);
assert.equal(authority.selectorId,"send");
assert.equal(canAuthorizeAction(authority),true);
const broad=evaluateContracts([{id:"broad",selector:"#send",rank:RANK.BROAD_GENERIC}],host);
assert.equal(broad[0].state,HEALTH.FAIL);
console.log("selector-ranking: PASS");
