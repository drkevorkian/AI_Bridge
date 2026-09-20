import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const bg=fs.readFileSync(path.join(here,"../runtime_review/background.js"),"utf8");

for(const token of [
  "async function reviewAdoptAwaitingRecoveredContinuation",
  "record.status === DISPATCH_STATUS.AWAITING_RESPONSE",
  "Number(record.createdAt) >= createdFloor",
  "record.side === pending.targetSide",
  "record.payloadHash === payloadHash",
  "Number(dispatch.tabId) !== Number(authority.tabId)",
  "Number(dispatch.generationEpoch) !== Number(authority.generationEpoch)",
  "!reviewSameIdentity(dispatch.conversationIdentity, authority.identity)",
  "await reviewClearNextTurnPending(pending.sourceDispatchId)",
  'state.runtimePhase = "AWAITING_PROVIDER_RESPONSE"',
  "alreadySent: true",
  "const adopted = await reviewAdoptAwaitingRecoveredContinuation(pending)",
  "if (adopted) return adopted"
]) assert.ok(bg.includes(token),"missing recovery adoption invariant: "+token);

const helperStart=bg.indexOf("async function reviewAdoptAwaitingRecoveredContinuation");
const helperEnd=bg.indexOf("\nasync function reviewRecoverNextTurnPending",helperStart);
assert.ok(helperStart>=0&&helperEnd>helperStart,"adoption helper block missing");
const helper=bg.slice(helperStart,helperEnd);

assert.doesNotMatch(helper,/DISPATCH_STATUS\.(DISPATCHING|ACCEPTED|DELIVERY_AMBIGUOUS)/,
  "only proven AWAITING_RESPONSE dispatches may be adopted");
assert.ok(
  helper.indexOf("reviewRegisterSideAuthority") <
  helper.indexOf("reviewClearNextTurnPending"),
  "current provider authority must be proven before clearing durable continuation"
);

const continuationStart=bg.indexOf("async function reviewContinueAfterCommittedResponse");
const continuationEnd=bg.indexOf("\nasync function reviewProcessIncomingEnvelope",continuationStart);
assert.ok(continuationStart>=0&&continuationEnd>continuationStart,"continuation block missing");
const continuation=bg.slice(continuationStart,continuationEnd);
assert.ok(
  continuation.indexOf("reviewAdoptAwaitingRecoveredContinuation(pending)") <
  continuation.indexOf("await sendToSide(pending.targetSide"),
  "recovery must attempt adoption before any replay"
);

console.log("round43-next-turn-adoption: PASS");
