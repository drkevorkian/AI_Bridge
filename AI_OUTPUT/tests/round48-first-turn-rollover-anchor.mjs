import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
const require=createRequire(import.meta.url);
const {RolloverCoordinator,FINAL_RESPONSE_ANCHOR_KIND}=require("../thread_rollover/rollover-coordinator.js");

const oldAuthority={side:"A",tabId:42,generationEpoch:7,identity:{provider:"chatgpt",kind:"conversation",routeClass:"conversation",threadKey:"old",provisional:false,writable:true},state:"CONFIRMED"};
const limit={state:"HARD_THREAD_LIMIT",automaticRollover:true};
const identity=oldAuthority.identity;

const coord=new RolloverCoordinator();
coord.begin({rolloverId:"first-turn",side:"A",provider:"chatgpt",triggeringDispatchId:"rejected-first",oldAuthority,hardLimitEvidence:limit,startedAt:10});
coord.anchorProviderSnapshot("A",{
  contentHash:"a".repeat(64),
  observedAt:11,
  conversationIdentity:identity
},12);
let tx=coord.get("A");
assert.equal(tx.phase,"FINAL_RESPONSE_COMMITTED");
assert.equal(tx.finalResponseDispatchId,null);
assert.equal(tx.finalResponseAnchor.kind,FINAL_RESPONSE_ANCHOR_KIND.PROVIDER_SNAPSHOT);
assert.equal(tx.finalResponseAnchor.contentHash,"a".repeat(64));
const restored=new RolloverCoordinator(coord.snapshot()).get("A");
assert.equal(restored.finalResponseAnchor.kind,"PROVIDER_SNAPSHOT");
assert.equal(restored.finalResponseDispatchId,null);

const root=path.resolve(here,"..");
const bg=fs.readFileSync(path.join(root,"runtime_review","background.js"),"utf8");
const content=fs.readFileSync(path.join(root,"runtime_review","content.js"),"utf8");
const core=fs.readFileSync(path.join(root,"runtime_review","runtime-core.js"),"utf8");
for(const token of [
  "PROVIDER_SNAPSHOT","anchorProviderSnapshot","ROLLOVER_PROVIDER_SNAPSHOT_HASH_MISMATCH",
  "ROLLOVER_NO_PRIOR_COMMITTED_RESPONSE_OR_PROVIDER_SNAPSHOT","providerSnapshotHash",
  "preSendAssistantText","preSendAssistantObservedAt","preSendAssistantIdentity",
  "THREAD_LIMIT_PROVIDER_SNAPSHOT_TIMESTAMP_INVALID",
  "THREAD_LIMIT_PROVIDER_SNAPSHOT_IDENTITY_MISMATCH",
  "ROLLOVER_PROVIDER_SNAPSHOT_PROVENANCE_MISSING"
]) assert.ok(bg.includes(token)||content.includes(token)||core.includes(token),"missing "+token);
assert.ok(content.includes('preSendAssistantText:String(responseBaseline.text||"").slice(0,200000)'));
assert.ok(content.includes('preSendAssistantObservedAt:responseBaselineObservedAt'));
assert.ok(content.includes('preSendAssistantIdentity:responseBaselineIdentity'));
assert.ok(content.includes('preSendAssistantText:String(awaitingResponseContext?.preSendAssistantText||"").slice(0,200000)'));
assert.ok(content.includes('preSendAssistantObservedAt:Number(awaitingResponseContext?.preSendAssistantObservedAt)||null'));
assert.ok(content.includes('preSendAssistantIdentity:awaitingResponseContext?.preSendAssistantIdentity||null'));
assert.ok(bg.includes('providerSnapshotObservedAt=authorized.preSendAssistantObservedAt;'));
assert.ok(bg.includes('providerSnapshotIdentity=authorized.preSendAssistantIdentity;'));
assert.doesNotMatch(bg,/providerSnapshotObservedAt=Number\(msg\?\.observedAt\)\|\|Date\.now\(\)/);
assert.doesNotMatch(bg,/ROLLOVER_NO_PRIOR_COMMITTED_RESPONSE"/);
console.log("round48-first-turn-rollover-anchor: PASS");
