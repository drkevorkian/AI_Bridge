import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"..");
const bg=fs.readFileSync(path.join(root,"runtime_review","background.js"),"utf8");
const dash=fs.readFileSync(path.join(root,"runtime_review","dashboard.js"),"utf8");
const manifest=JSON.parse(fs.readFileSync(path.join(root,"runtime_review","manifest.json"),"utf8"));

for(const token of [
  "async function reviewProbeRecoveryTarget(targetSide)",
  "function reviewRecoveryResponseAdvancedPast(sourceEntry,targetSide,targetResponse)",
  "async function reviewResolveCommittedRecoveryStep(sourceSide,recoveredText)",
  "async function reviewResolveRecoveryBoundary(startSide,startRecovered)"
]) assert.ok(bg.includes(token),"missing recovery catch-up contract: "+token);

const stepStart=bg.indexOf("async function reviewResolveCommittedRecoveryStep");
const stepEnd=bg.indexOf("async function reviewResolveRecoveryBoundary",stepStart);
assert.ok(stepStart>=0&&stepEnd>stepStart,"recovery step boundary missing");
const step=bg.slice(stepStart,stepEnd);

for(const token of [
  "DISPATCH_STATUS.DELIVERY_AMBIGUOUS",
  "DISPATCH_STATUS.ACCEPTED",
  "DISPATCH_STATUS.AWAITING_RESPONSE",
  "DISPATCH_STATUS.RESPONSE_COMMITTED",
  "unsafe.length>0 &&",
  "reviewRecoveryResponseAdvancedPast(entry,targetSide,targetProbe.response)",
  'evidence:"VISIBLE_DOWNSTREAM_RESPONSE"',
  "targetProbe.freshSurface",
  "unsafe.every(record=>record.status===DISPATCH_STATUS.DELIVERY_AMBIGUOUS)",
  'evidence:ambiguousFreshSurface?"TARGET_STILL_FRESH_SURFACE":"PRE_ACTION_FAILURE"'
]) assert.ok(step.includes(token),"recovery step safety contract missing "+token);

assert.ok(
  step.indexOf("const unsafe=matching.filter") <
  step.indexOf("reviewRecoveryResponseAdvancedPast(entry,targetSide,targetProbe.response)"),
  "downstream response may advance recovery only after a matching prior delivery record is established"
);

const advanceStart=bg.indexOf("function reviewRecoveryResponseAdvancedPast");
const advanceEnd=bg.indexOf("async function reviewResolveCommittedRecoveryStep",advanceStart);
const advance=bg.slice(advanceStart,advanceEnd);
assert.ok(advance.includes("if(visibleText!==committedText) return true;"));
assert.ok(advance.includes("Number(targetEntry.seq)>Number(sourceEntry?.seq||0)"),
  "already-committed downstream response must be newer than source transcript entry");

const catchStart=bg.indexOf("async function reviewResolveRecoveryBoundary");
const catchEnd=bg.indexOf("function reviewManualRelayAwaitingDispatch",catchStart);
const catchup=bg.slice(catchStart,catchEnd);
assert.ok(catchup.includes("const visited=new Set();"),"catch-up cycle guard missing");
assert.ok(catchup.includes("for(let hop=0;hop<SIDES.length;hop++)"),"catch-up hop bound missing");
assert.ok(catchup.includes("RECOVERY_START_CATCHUP_CYCLE"),"cycle must fail closed");
assert.ok(catchup.includes("RECOVERY_START_CATCHUP_HOP_LIMIT"),"hop limit must fail closed");
assert.doesNotMatch(catchup,/recordTranscript\(|state\.turn\s*\+=/,"catch-up must not duplicate transcript or turn count");

const handlerStart=bg.indexOf('if (msg.type === "AI_BRIDGE_READ_RESPONSE_TO_START")');
const handlerEnd=bg.indexOf('if (msg.type === "AI_BRIDGE_UPDATE_RULES")',handlerStart);
assert.ok(handlerStart>=0&&handlerEnd>handlerStart,"recovery handler boundary missing");
const handler=bg.slice(handlerStart,handlerEnd);
for(const token of [
  "const boundary=await reviewResolveRecoveryBoundary(sourceSide,initiallyRecovered);",
  "const effectiveSourceSide=boundary.sourceSide;",
  "const caughtUpSides=boundary.caughtUpSides||[];",
  'state.runtimePhase=caughtUpSides.length?"RECOVERY_START_CAUGHT_UP":"RECOVERY_START_PROCESSING";',
  "await handleCompletedResponse(effectiveSourceSide,recovered.text",
  "effectiveSourceSide,",
  "caughtUpSides,"
]) assert.ok(handler.includes(token),"handler catch-up wiring missing "+token);
assert.ok(
  handler.indexOf("const boundary=await reviewResolveRecoveryBoundary") <
  handler.indexOf("await reviewResetSessionDurability();"),
  "recovery must inspect old durable ledger before resetting it"
);

assert.ok(dash.includes('RECOVERY_START_CAUGHT_UP: "Caught up to latest completed AI response"'));
assert.ok(dash.includes("Recovery caught up from AI"));
assert.ok(dash.includes("res.effectiveSourceSide"));
assert.equal(manifest.version_name,"1.19.1.37-AI-A");

console.log("round77-recovery-catchup: PASS");
