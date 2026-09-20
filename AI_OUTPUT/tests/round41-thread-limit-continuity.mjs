import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const signatures = require("../thread_rollover/provider-limit-signatures.js");
const continuity = require("../thread_rollover/continuity-payload.js");
const { PHASE, RolloverCoordinator } = require("../thread_rollover/rollover-coordinator.js");

const cutoff = "You've reached the maximum length for this conversation, but you can keep talking by starting a new chat.";

const limit = signatures.classifyThreadLimit({
  provider: "chatgpt",
  regions: [{ kind: "provider-notice", text: cutoff, visible: true }],
  composer: { present: true, disabled: true }
});
assert.equal(limit.state, "HARD_THREAD_LIMIT");
assert.equal(limit.automaticRollover, true);

const untrusted = signatures.classifyThreadLimit({
  provider: "chatgpt",
  regions: [{ kind: "assistant-response", text: cutoff, visible: true }],
  composer: { present: true, disabled: false }
});
assert.equal(untrusted.state, "UNTRUSTED_TEXT_ONLY");
assert.equal(untrusted.automaticRollover, false);

assert.equal(continuity.nextContinuationTitle("Backend Debug Discovery"), "Backend Debug Discovery - II");
assert.equal(continuity.nextContinuationTitle("Backend Debug Discovery - II"), "Backend Debug Discovery - III");
assert.equal(continuity.nextContinuationTitle("Backend Debug Discovery - IX"), "Backend Debug Discovery - X");
assert.equal(continuity.nextContinuationTitle("Backend Debug Discovery - XLIX"), "Backend Debug Discovery - L");
assert.equal(continuity.nextContinuationTitle("Backend Debug Discovery - I"), "Backend Debug Discovery - I - II");
assert.equal(continuity.nextContinuationTitle("Backend Debug Discovery - IIII"), "Backend Debug Discovery - IIII - II");

const messages = [
  { role: "assistant", kind: "assistant-response", text: "Earlier answer", completed: true },
  { role: "assistant", kind: "assistant-response", text: "Final completed answer before cutoff", completed: true },
  { role: "assistant", kind: "assistant-response", text: "Streaming fragment", completed: false },
  { role: "assistant", kind: "provider-notice", text: cutoff, completed: true }
];

const payload = continuity.buildContinuationPayload({
  title: "Backend Debug Discovery - II",
  provider: "chatgpt",
  limitEvidence: limit,
  messages
});
assert.deepEqual(payload, {
  schema: 1,
  provider: "chatgpt",
  previousTitle: "Backend Debug Discovery - II",
  nextTitle: "Backend Debug Discovery - III",
  lastAssistantMessage: "Final completed answer before cutoff",
  sourceMessageIndex: 1
});

assert.throws(
  () => continuity.buildContinuationPayload({
    title: "Backend Debug Discovery",
    provider: "chatgpt",
    limitEvidence: { state: "NO_LIMIT_SIGNAL", automaticRollover: false },
    messages
  }),
  /HARD_THREAD_LIMIT/
);

assert.throws(
  () => continuity.lastCompletedAssistantMessage([
    { role: "assistant", kind: "assistant-response", text: "x".repeat(21), completed: true }
  ], { maxChars: 20 }),
  /exceeds continuity limit/
);

const oldIdentity = { provider:"chatgpt", kind:"conversation", routeClass:"conversation", threadKey:"old", writable:true, provisional:false };
const oldAuthority = { side:"B", tabId:10, generationEpoch:5, identity:oldIdentity, state:"CONFIRMED" };
const revoked = { ...oldAuthority, state:"REVOKED" };
const freshSurface = {
  side:"B", tabId:10, generationEpoch:6,
  identity:{ provider:"chatgpt", kind:"surface", routeClass:"home", threadKey:null, writable:true, provisional:true },
  state:"PROVISIONAL"
};
const confirmedConversation = {
  side:"B", tabId:10, generationEpoch:6,
  identity:{ provider:"chatgpt", kind:"conversation", routeClass:"conversation", threadKey:"new", writable:true, provisional:false },
  state:"CONFIRMED"
};

const coord = new RolloverCoordinator();
coord.begin({
  rolloverId:"r1",
  side:"B",
  provider:"chatgpt",
  triggeringDispatchId:"d-old",
  oldAuthority,
  hardLimitEvidence:limit,
  startedAt:1
});
coord.transition("B", PHASE.OLD_AUTHORITY_REVOKED, { oldAuthority:revoked }, 2);
coord.transition("B", PHASE.OPENING_NEW_CHAT, {}, 3);
coord.transition("B", PHASE.AWAITING_NEW_IDENTITY, {}, 4);
coord.transition("B", PHASE.NEW_IDENTITY_VERIFIED, { candidateAuthority:freshSurface }, 5);
coord.transition("B", PHASE.CONTINUITY_PENDING, { continuityDispatchId:"d-cont", continuityStatus:"PENDING" }, 6);
coord.transition("B", PHASE.CONTINUITY_SENT, { continuityStatus:"ACCEPTED" }, 7);
coord.transition("B", PHASE.AWAITING_CONTINUITY_RESPONSE, {}, 8);

assert.equal(
  coord.canAcceptContinuityResponse({
    side:"B", rolloverId:"r1", dispatchId:"d-cont", observedIdentity:confirmedConversation.identity
  }).reason,
  "CANDIDATE_CONFIRMATION_PENDING"
);

coord.promoteCandidateAuthority("B", confirmedConversation, 9);

assert.deepEqual(
  coord.canAcceptContinuityResponse({
    side:"B", rolloverId:"r1", dispatchId:"d-cont", observedIdentity:confirmedConversation.identity
  }),
  { ok:true, reason:"NEW_CONVERSATION_CONFIRMED" }
);

assert.throws(
  () => coord.promoteCandidateAuthority("B", {
    ...confirmedConversation,
    identity:{ ...confirmedConversation.identity, threadKey:"old" }
  }, 10),
  /cannot reuse the old conversation identity/
);

console.log("round41-thread-limit-continuity: PASS");
