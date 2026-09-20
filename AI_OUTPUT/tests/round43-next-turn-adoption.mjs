import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const bg=fs.readFileSync(path.join(here,"../runtime_review/background.js"),"utf8");

for(const token of [
  "async function reviewAdoptAwaitingRecoveredContinuation",
  "DISPATCH_STATUS.ACCEPTED",
  "DISPATCH_STATUS.AWAITING_RESPONSE",
  "DISPATCH_STATUS.DELIVERY_AMBIGUOUS",
  "reviewReadContentActionProof(dispatch)",
  "reviewLedger.recoverAcceptedAfterRestart",
  "record.continuationSourceDispatchId",
  "const sourceId = String(pending.sourceDispatchId)",
  "Number(record.createdAt) >= createdFloor",
  "Number(dispatch.tabId) !== Number(authority.tabId)",
  "Number(dispatch.generationEpoch) !== Number(authority.generationEpoch)",
  "!reviewSameIdentity(dispatch.conversationIdentity, authority.identity)",
  "await reviewClearNextTurnPending(pending.sourceDispatchId)",
  'state.runtimePhase = "AWAITING_PROVIDER_RESPONSE"',
  "alreadySent: true",
  "const adopted = await reviewAdoptAwaitingRecoveredContinuation(pending)",
  "if (adopted?.blocked)",
  "if (adopted) return adopted"
]) assert.ok(bg.includes(token),"missing recovery adoption invariant: "+token);

const helperStart=bg.indexOf("async function reviewAdoptAwaitingRecoveredContinuation");
const helperEnd=bg.indexOf("\nasync function reviewRecoverNextTurnPending",helperStart);
assert.ok(helperStart>=0&&helperEnd>helperStart,"adoption helper block missing");
const helper=bg.slice(helperStart,helperEnd);

assert.doesNotMatch(helper,/candidateStatuses[\s\S]{0,220}DISPATCH_STATUS\.DISPATCHING/,
  "DISPATCHING may not be adopted without first becoming restart ambiguity");
assert.ok(
  helper.indexOf("reviewRegisterSideAuthority") <
  helper.indexOf("reviewClearNextTurnPending"),
  "current provider authority must be proven before clearing durable continuation"
);
assert.ok(
  helper.indexOf("reviewReadContentActionProof(dispatch)") <
  helper.indexOf("reviewLedger.recoverAcceptedAfterRestart(dispatch.dispatchId"),
  "content proof must precede restart-ambiguous ledger recovery"
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
assert.ok(
  continuation.includes("No duplicate prompt was sent."),
  "blocked recovery must explicitly preserve no-replay behavior"
);

console.log("round43-next-turn-adoption: PASS");
