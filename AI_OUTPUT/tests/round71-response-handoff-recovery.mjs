import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const bg=fs.readFileSync(path.join(here,"../runtime_review/background.js"),"utf8");
const content=fs.readFileSync(path.join(here,"../runtime_review/content.js"),"utf8");

assert.ok(content.includes('"button#composer-submit-button"'),"exact ChatGPT composer submit id must be trusted");
for(const token of [
  "let pendingResponseDelivery = null;",
  "async function deliverPendingResponse()",
  "acknowledgement?.durableResponseAccepted===true",
  "scheduleResponseDelivery(backoff)",
  'type:"AI_BRIDGE_RESPONSE"',
  'if(pendingResponseDelivery){scheduleResponseDelivery(0);return;}',
  'if(msg.type==="AI_BRIDGE_READ_LATEST_EXCHANGE")',
  "assistantAfterUser",
  "user.compareDocumentPosition(assistant.node)&4"
]) assert.ok(content.includes(token),"content response handoff invariant missing "+token);

const monitorStart=content.indexOf("async function monitor()");
const scheduleStart=content.indexOf("function scheduleMonitor",monitorStart);
assert.ok(monitorStart>=0&&scheduleStart>monitorStart,"monitor boundary missing");
const monitor=content.slice(monitorStart,scheduleStart);
assert.ok(
  monitor.indexOf("pendingResponseDelivery=Object.freeze") <
  monitor.indexOf("scheduleResponseDelivery(0)"),
  "response envelope must be retained before delivery is attempted"
);
assert.doesNotMatch(
  monitor,
  /awaitingDispatchId=null[\s\S]{0,500}chrome\.runtime\.sendMessage/,
  "monitor must not clear response authority before durable background acknowledgement"
);

for(const token of [
  "function reviewResponseEnvelopeMatchesDispatch",
  "function reviewRecoverAwaitingResponsesFromPages",
  'dispatch.status === DISPATCH_STATUS.RESPONSE_COMMITTED',
  "durableResponseAccepted:true",
  'type:"AI_BRIDGE_READ_LATEST_EXCHANGE"',
  "reviewComparablePromptText(userText)!==reviewComparablePromptText(expectedPrompt)",
  "await reviewPayloadHash(side,expectedPrompt)!==String(record.payloadHash||"")",
  "await reviewRecoverAwaitingResponsesFromPages();",
  "const recoveredAwaiting=await reviewRecoverAwaitingResponsesFromPages();"
]) assert.ok(bg.includes(token),"background response recovery invariant missing "+token);

const recoveryStart=bg.indexOf("async function reviewRecoverAwaitingResponsesFromPages");
const processStart=bg.indexOf("async function reviewProcessIncomingEnvelope",recoveryStart);
assert.ok(recoveryStart>=0&&processStart>recoveryStart,"page recovery boundary missing");
const recovery=bg.slice(recoveryStart,processStart);
for(const token of [
  "record.status===DISPATCH_STATUS.AWAITING_RESPONSE",
  "Number(tabForSide(side))!==Number(record.tabId)",
  "Number(authority.generationEpoch)!==Number(record.generationEpoch)",
  "proof.active===true",
  "proof.assistantAfterUser!==true",
  "reviewSameIdentity(proofIdentity,authority.identity)",
  "reviewProcessIncomingEnvelope({"
]) assert.ok(recovery.includes(token),"fail-closed page recovery check missing "+token);
assert.doesNotMatch(recovery,/sendToSide\(/,"page recovery must never resend the unresolved prompt itself");

console.log("round71-response-handoff-recovery: PASS");
