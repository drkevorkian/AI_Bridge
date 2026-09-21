import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"..");
const bg=fs.readFileSync(path.join(root,"runtime_review","background.js"),"utf8");
const dash=fs.readFileSync(path.join(root,"runtime_review","dashboard.js"),"utf8");
const html=fs.readFileSync(path.join(root,"runtime_review","dashboard.html"),"utf8");
const manifest=JSON.parse(fs.readFileSync(path.join(root,"runtime_review","manifest.json"),"utf8"));

assert.ok(bg.includes('"AI_BRIDGE_READ_RESPONSE_TO_START"'));
assert.ok(bg.includes("async function reviewReadResponseToStartSource(sourceSide)"));
assert.ok(bg.includes('{type:"AI_BRIDGE_READ_LAST_RESPONSE"}'));
assert.ok(bg.includes('{documentId:String(record.documentId)}'));
assert.ok(bg.includes("RECOVERY_START_RESPONSE_AUTHORITY_MISMATCH"));
assert.ok(bg.includes("RECOVERY_START_DUPLICATE_RESPONSE"));
assert.ok(bg.includes("await reviewResetSessionDurability();"));
assert.ok(bg.includes("const result=await handleCompletedResponse(sourceSide,recovered.text"));
assert.ok(bg.includes("relay:true"));
assert.ok(bg.includes('state.runtimePhase="RECOVERY_START_PROCESSING"'));

const helperStart=bg.indexOf("async function reviewReadResponseToStartSource");
const helperEnd=bg.indexOf("function reviewManualRelayAwaitingDispatch",helperStart);
assert.ok(helperStart>=0 && helperEnd>helperStart);
const helper=bg.slice(helperStart,helperEnd);
assert.doesNotMatch(helper,/reviewManualRelayAwaitingDispatch|AWAITING_RESPONSE/);

// Recovery must reuse normal Direct Mesh routing rather than invent another parser.
assert.ok(bg.includes("const command = extractRegisteredLlmCommand(text, side);"));
assert.ok(bg.includes("const targetSide = command?.targetSide || nextSide(side);"));
assert.ok(bg.includes("directTurnMessage(side, targetSide, entry)"));
assert.ok(bg.includes('throw new Error("Read Response to Start supports Relay, Collaborate, and Direct Mesh. Batch modes require the full phase state.")'));

assert.ok(html.includes('id="readResponseStartSide"'));
assert.ok(html.includes('id="readResponseStart"'));
assert.ok(html.includes("Read A response to start"));
assert.ok(html.includes("Direct Mesh reads its final SEND TO command"));

assert.ok(dash.includes('type: "AI_BRIDGE_READ_RESPONSE_TO_START"'));
assert.ok(dash.includes("updateRecoveryStartLabel"));
assert.ok(dash.includes("stoppedRecoveryAvailable"));
assert.ok(dash.includes("Automatic Bridge operation has restarted."));
assert.ok(dash.includes('READ_RESPONSE_TO_START: "Reading stopped-session response"'));
assert.ok(dash.includes('RECOVERY_START_PROCESSING: "Restarting from recovered response"'));

assert.equal(manifest.version_name,"1.19.1.34-AI-A");
console.log("round74-read-response-to-start: PASS");
