import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"..");
const bg=fs.readFileSync(path.join(root,"runtime_review","background.js"),"utf8");
const dash=fs.readFileSync(path.join(root,"runtime_review","dashboard.js"),"utf8");
const manifest=JSON.parse(fs.readFileSync(path.join(root,"runtime_review","manifest.json"),"utf8"));

assert.ok(bg.includes("async function reviewPrepareCommittedRecoveryReplay(sourceSide,recoveredText)"));
assert.ok(bg.includes("String(state.lastResponseBySide?.[sourceSide]||\"\")!==String(recoveredText||\"\")"));
assert.ok(bg.includes("const payloadHash=await reviewPayloadHash(targetSide,outgoing.text);"));
assert.ok(bg.includes("DISPATCH_STATUS.DELIVERY_AMBIGUOUS"));
assert.ok(bg.includes("DISPATCH_STATUS.RESPONSE_COMMITTED"));
assert.ok(bg.includes("record.acceptedAt==null"));
assert.ok(bg.includes("HARD_THREAD_LIMIT_REJECTED_BY_PROVIDER"));
assert.ok(bg.includes("RECOVERY_START_DUPLICATE_RESPONSE_NO_PROVEN_FAILED_HANDOFF"));
assert.ok(bg.includes("RECOVERY_START_REPLAY_BLOCKED_BY_PRIOR_DELIVERY"));
assert.ok(bg.includes("state.runtimePhase=\"RECOVERY_START_REPLAYING_FAILED_HANDOFF\""));
assert.ok(bg.includes("await sendToSide(replayPlan.targetSide,replayPlan.outgoing.text"));
assert.ok(bg.includes("replayedCommitted:true"));

const helperStart=bg.indexOf("async function reviewPrepareCommittedRecoveryReplay");
const helperEnd=bg.indexOf("async function reviewReadResponseToStartSource",helperStart);
assert.ok(helperStart>=0&&helperEnd>helperStart,"replay helper boundary missing");
const helper=bg.slice(helperStart,helperEnd);
assert.doesNotMatch(helper,/recordTranscript\(|state\.turn\s*\+=/,"replay must not duplicate transcript or turn count");
assert.ok(helper.includes("directTurnMessage(sourceSide,targetSide,entry)"));
assert.ok(helper.includes("normalTurnMessage(targetSide)"));

const handlerStart=bg.indexOf('if (msg.type === "AI_BRIDGE_READ_RESPONSE_TO_START")');
const handlerEnd=bg.indexOf('if (msg.type === "AI_BRIDGE_UPDATE_RULES")',handlerStart);
assert.ok(handlerStart>=0&&handlerEnd>handlerStart,"recovery handler boundary missing");
const handler=bg.slice(handlerStart,handlerEnd);
assert.ok(handler.includes("const replayPlan=await reviewPrepareCommittedRecoveryReplay(sourceSide,recovered.text);"));
assert.ok(handler.includes("if(replayPlan){"));
assert.ok(handler.includes("await reviewResetSessionDurability();"));
assert.ok(handler.indexOf("const replayPlan=await reviewPrepareCommittedRecoveryReplay") < handler.indexOf("await reviewResetSessionDurability();"),"must prove old failed dispatch before resetting durable ledger");
assert.ok(handler.includes("priorDispatchIds:replayPlan.priorDispatchIds"));

assert.ok(dash.includes('RECOVERY_START_REPLAYING_FAILED_HANDOFF: "Replaying previously failed recovery handoff"'));
assert.ok(dash.includes("res.replayedCommitted"));
assert.equal(manifest.version_name,"1.19.1.36-AI-A");
console.log("round76-replay-failed-recovery-handoff: PASS");
