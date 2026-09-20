import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  PHASES,
  RolloverTransaction
} = require('../thread_rollover/thread-rollover.js');

const oldIdentity = Object.freeze({
  provider: 'chatgpt',
  kind: 'conversation',
  routeClass: 'conversation',
  threadKey: 'old-1',
  provisional: false,
  writable: true
});
const newSurface = Object.freeze({
  provider: 'chatgpt',
  kind: 'surface',
  routeClass: 'home',
  threadKey: null,
  provisional: true,
  writable: true
});
const newIdentity = Object.freeze({
  provider: 'chatgpt',
  kind: 'conversation',
  routeClass: 'conversation',
  threadKey: 'new-2',
  provisional: false,
  writable: true
});
const limitEvidence = Object.freeze({
  state: 'HARD_THREAD_LIMIT',
  automaticRollover: true
});

let tx = RolloverTransaction.begin({
  rolloverId: 'roll-1',
  side: 'A',
  provider: 'chatgpt',
  oldAuthority: oldIdentity,
  triggeringDispatchId: 'dispatch-old',
  limitEvidence,
  now: 1
});
assert.equal(tx.snapshot().phase, PHASES.LIMIT_CONFIRMED);
assert.throws(
  () => tx.markOpeningNewChat(2),
  /Invalid rollover transition/
);

tx.revokeOldAuthority(2);
tx.markOpeningNewChat(3);
tx.observeIdentity(newSurface, 4);
assert.equal(tx.snapshot().phase, PHASES.NEW_CHAT_SURFACE);
tx.prepareContinuity('continuity-1', 5);
tx.markContinuityAccepted('continuity-1', 6);
tx.awaitContinuityResponse(7);

const done = tx.acceptContinuityResponse({
  dispatchId: 'continuity-1',
  identity: newIdentity
}, 8);
assert.equal(done.phase, PHASES.COMPLETE);
assert.equal(done.continuityStatus, 'RESPONSE_ACCEPTED');

const stale = RolloverTransaction.begin({
  rolloverId: 'roll-2',
  side: 'B',
  provider: 'chatgpt',
  oldAuthority: oldIdentity,
  triggeringDispatchId: 'dispatch-old-2',
  limitEvidence,
  now: 10
});
stale.revokeOldAuthority(11);
stale.markOpeningNewChat(12);
const staleResult = stale.observeIdentity(oldIdentity, 13);
assert.equal(staleResult.phase, PHASES.FAILED);
assert.match(staleResult.failureReason, /did not change/i);

const readOnly = RolloverTransaction.begin({
  rolloverId: 'roll-3',
  side: 'C',
  provider: 'grok',
  oldAuthority: { ...oldIdentity, provider: 'grok' },
  triggeringDispatchId: 'dispatch-old-3',
  limitEvidence,
  now: 20
});
readOnly.revokeOldAuthority(21);
readOnly.markOpeningNewChat(22);
const readOnlyResult = readOnly.observeIdentity({
  provider: 'grok',
  kind: 'share',
  routeClass: 'share',
  threadKey: 'share-1',
  provisional: false,
  writable: false
}, 23);
assert.equal(readOnlyResult.phase, PHASES.FAILED);

const stableSurfaceDenied = RolloverTransaction.begin({
  rolloverId: 'roll-4',
  side: 'A',
  provider: 'chatgpt',
  oldAuthority: oldIdentity,
  triggeringDispatchId: 'dispatch-old-4',
  limitEvidence,
  now: 30
});
stableSurfaceDenied.revokeOldAuthority(31);
stableSurfaceDenied.markOpeningNewChat(32);
stableSurfaceDenied.observeIdentity(newSurface, 33);
stableSurfaceDenied.prepareContinuity('continuity-4', 34);
stableSurfaceDenied.markContinuityAccepted('continuity-4', 35);
const denied = stableSurfaceDenied.acceptContinuityResponse({
  dispatchId: 'continuity-4',
  identity: newSurface
}, 36);
assert.equal(denied.phase, PHASES.FAILED);

const ambiguous = RolloverTransaction.begin({
  rolloverId: 'roll-5',
  side: 'A',
  provider: 'chatgpt',
  oldAuthority: oldIdentity,
  triggeringDispatchId: 'dispatch-old-5',
  limitEvidence,
  now: 40
});
ambiguous.revokeOldAuthority(41);
ambiguous.markOpeningNewChat(42);
ambiguous.observeIdentity(newSurface, 43);
ambiguous.prepareContinuity('continuity-5', 44);
const amb = ambiguous.markDeliveryAmbiguous(
  'Content acknowledgement lost after provider submit.',
  45
);
assert.equal(amb.phase, PHASES.DELIVERY_AMBIGUOUS);
assert.equal(ambiguous.isTerminal(), true);

console.log('thread-rollover: ok');
