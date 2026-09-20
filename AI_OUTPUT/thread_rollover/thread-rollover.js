'use strict';

/**
 * Review-only rollover state machine.
 *
 * This module deliberately owns no Chrome APIs. Background integration can
 * persist snapshots between transitions and therefore survive MV3 worker
 * restarts without replaying an already-accepted continuity send.
 */
(function initThreadRollover(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.AIBridgeThreadRollover = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const PHASES = Object.freeze({
    IDLE: 'IDLE',
    LIMIT_CONFIRMED: 'LIMIT_CONFIRMED',
    OLD_AUTHORITY_REVOKED: 'OLD_AUTHORITY_REVOKED',
    OPENING_NEW_CHAT: 'OPENING_NEW_CHAT',
    NEW_CHAT_SURFACE: 'NEW_CHAT_SURFACE',
    NEW_CONVERSATION_CONFIRMED: 'NEW_CONVERSATION_CONFIRMED',
    CONTINUITY_PENDING: 'CONTINUITY_PENDING',
    CONTINUITY_ACCEPTED: 'CONTINUITY_ACCEPTED',
    AWAITING_CONTINUITY_RESPONSE: 'AWAITING_CONTINUITY_RESPONSE',
    COMPLETE: 'COMPLETE',
    DELIVERY_AMBIGUOUS: 'DELIVERY_AMBIGUOUS',
    FAILED: 'FAILED'
  });

  const TERMINAL_PHASES = new Set([
    PHASES.COMPLETE,
    PHASES.DELIVERY_AMBIGUOUS,
    PHASES.FAILED
  ]);

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function requireString(name, value) {
    const normalized = String(value || '').trim();
    if (!normalized) throw new Error(`${name} is required.`);
    return normalized;
  }

  function identitiesEquivalent(a, b) {
    if (!a || !b || a.provider !== b.provider || a.kind !== b.kind) return false;
    if (a.kind === 'conversation') {
      return Boolean(a.threadKey) && a.threadKey === b.threadKey;
    }
    return a.routeClass === b.routeClass &&
      Boolean(a.provisional) === Boolean(b.provisional);
  }

  function assertWritable(identity) {
    if (!identity || identity.writable !== true) {
      throw new Error('Conversation identity is not writable.');
    }
  }

  class RolloverTransaction {
    constructor(snapshot) {
      if (!snapshot || typeof snapshot !== 'object') {
        throw new Error('A rollover snapshot is required.');
      }
      this.state = clone(snapshot);
      this._validateSnapshot();
    }

    static begin({
      rolloverId,
      side,
      provider,
      oldAuthority,
      triggeringDispatchId,
      limitEvidence,
      now = Date.now()
    }) {
      requireString('rolloverId', rolloverId);
      requireString('side', side);
      requireString('provider', provider);
      requireString('triggeringDispatchId', triggeringDispatchId);
      if (!oldAuthority || oldAuthority.provider !== provider) {
        throw new Error('Old authority must belong to the rollover provider.');
      }
      if (
        limitEvidence?.state !== 'HARD_THREAD_LIMIT' ||
        limitEvidence?.automaticRollover !== true
      ) {
        throw new Error(
          'Automatic rollover requires authoritative hard thread-limit evidence.'
        );
      }

      return new RolloverTransaction({
        rolloverId,
        side,
        provider,
        phase: PHASES.LIMIT_CONFIRMED,
        oldAuthority: clone(oldAuthority),
        candidateAuthority: null,
        triggeringDispatchId,
        continuityDispatchId: null,
        continuityStatus: 'NONE',
        oldAuthorityRevoked: false,
        startedAt: now,
        updatedAt: now,
        failureReason: ''
      });
    }

    _validateSnapshot() {
      requireString('rolloverId', this.state.rolloverId);
      requireString('side', this.state.side);
      requireString('provider', this.state.provider);
      requireString('phase', this.state.phase);
      if (!Object.values(PHASES).includes(this.state.phase)) {
        throw new Error('Unknown rollover phase.');
      }
      if (
        !this.state.oldAuthority ||
        this.state.oldAuthority.provider !== this.state.provider
      ) {
        throw new Error('Rollover snapshot has invalid old authority.');
      }
    }

    _assertPhase(...allowed) {
      if (!allowed.includes(this.state.phase)) {
        throw new Error(`Invalid rollover transition from ${this.state.phase}.`);
      }
    }

    _touch(now = Date.now()) {
      this.state.updatedAt = now;
    }

    snapshot() {
      return Object.freeze(clone(this.state));
    }

    isTerminal() {
      return TERMINAL_PHASES.has(this.state.phase);
    }

    revokeOldAuthority(now = Date.now()) {
      this._assertPhase(PHASES.LIMIT_CONFIRMED);
      this.state.oldAuthorityRevoked = true;
      this.state.phase = PHASES.OLD_AUTHORITY_REVOKED;
      this._touch(now);
      return this.snapshot();
    }

    markOpeningNewChat(now = Date.now()) {
      this._assertPhase(PHASES.OLD_AUTHORITY_REVOKED);
      if (!this.state.oldAuthorityRevoked) {
        throw new Error(
          'Old authority must be revoked before opening a replacement chat.'
        );
      }
      this.state.phase = PHASES.OPENING_NEW_CHAT;
      this._touch(now);
      return this.snapshot();
    }

    observeIdentity(identity, now = Date.now()) {
      this._assertPhase(
        PHASES.OPENING_NEW_CHAT,
        PHASES.NEW_CHAT_SURFACE,
        PHASES.CONTINUITY_ACCEPTED,
        PHASES.AWAITING_CONTINUITY_RESPONSE
      );

      if (!identity || identity.provider !== this.state.provider) {
        return this.fail('Provider identity mismatch.', now);
      }
      if (identity.writable !== true) {
        return this.fail('Replacement route is not writable.', now);
      }
      if (identitiesEquivalent(identity, this.state.oldAuthority)) {
        return this.fail('Conversation identity did not change.', now);
      }

      this.state.candidateAuthority = clone(identity);
      if (
        identity.kind === 'conversation' &&
        identity.provisional !== true
      ) {
        this.state.phase = PHASES.NEW_CONVERSATION_CONFIRMED;
      } else if (
        identity.kind === 'surface' &&
        identity.provisional === true
      ) {
        this.state.phase = PHASES.NEW_CHAT_SURFACE;
      } else {
        return this.fail(
          'Replacement identity is not an approved chat surface or conversation.',
          now
        );
      }
      this._touch(now);
      return this.snapshot();
    }

    prepareContinuity(dispatchId, now = Date.now()) {
      this._assertPhase(
        PHASES.NEW_CHAT_SURFACE,
        PHASES.NEW_CONVERSATION_CONFIRMED
      );
      assertWritable(this.state.candidateAuthority);
      this.state.continuityDispatchId =
        requireString('continuityDispatchId', dispatchId);
      this.state.continuityStatus = 'PENDING';
      this.state.phase = PHASES.CONTINUITY_PENDING;
      this._touch(now);
      return this.snapshot();
    }

    markContinuityAccepted(dispatchId, now = Date.now()) {
      this._assertPhase(PHASES.CONTINUITY_PENDING);
      if (dispatchId !== this.state.continuityDispatchId) {
        throw new Error('Continuity dispatch ID mismatch.');
      }
      this.state.continuityStatus = 'ACCEPTED';
      this.state.phase = PHASES.CONTINUITY_ACCEPTED;
      this._touch(now);
      return this.snapshot();
    }

    awaitContinuityResponse(now = Date.now()) {
      this._assertPhase(
        PHASES.CONTINUITY_ACCEPTED,
        PHASES.NEW_CONVERSATION_CONFIRMED
      );
      if (this.state.continuityStatus !== 'ACCEPTED') {
        throw new Error('Continuity send has not been accepted.');
      }
      this.state.phase = PHASES.AWAITING_CONTINUITY_RESPONSE;
      this._touch(now);
      return this.snapshot();
    }

    acceptContinuityResponse(
      { dispatchId, identity, providerPolicy = {} },
      now = Date.now()
    ) {
      this._assertPhase(
        PHASES.CONTINUITY_ACCEPTED,
        PHASES.AWAITING_CONTINUITY_RESPONSE,
        PHASES.NEW_CONVERSATION_CONFIRMED
      );

      if (dispatchId !== this.state.continuityDispatchId) {
        throw new Error(
          'Response dispatch does not match continuity dispatch.'
        );
      }
      if (!identity || identity.provider !== this.state.provider) {
        return this.fail('Response provider identity mismatch.', now);
      }
      if (identitiesEquivalent(identity, this.state.oldAuthority)) {
        return this.fail('Stale old-thread response rejected.', now);
      }
      if (identity.writable !== true) {
        return this.fail('Response arrived from a non-writable route.', now);
      }

      const confirmedConversation =
        identity.kind === 'conversation' &&
        identity.provisional !== true;
      const stableSurfaceAllowed =
        identity.kind === 'surface' &&
        identity.provisional === true &&
        providerPolicy.allowStableSurfaceConversation === true;

      if (!confirmedConversation && !stableSurfaceAllowed) {
        return this.fail(
          'Response identity did not prove a new authorized conversation.',
          now
        );
      }

      this.state.candidateAuthority = clone(identity);
      this.state.continuityStatus = 'RESPONSE_ACCEPTED';
      this.state.phase = PHASES.COMPLETE;
      this._touch(now);
      return this.snapshot();
    }

    markDeliveryAmbiguous(reason, now = Date.now()) {
      this._assertPhase(
        PHASES.CONTINUITY_PENDING,
        PHASES.CONTINUITY_ACCEPTED,
        PHASES.AWAITING_CONTINUITY_RESPONSE
      );
      this.state.phase = PHASES.DELIVERY_AMBIGUOUS;
      this.state.failureReason = requireString('reason', reason);
      this._touch(now);
      return this.snapshot();
    }

    fail(reason, now = Date.now()) {
      this.state.phase = PHASES.FAILED;
      this.state.failureReason = requireString('reason', reason);
      this._touch(now);
      return this.snapshot();
    }
  }

  return Object.freeze({
    PHASES,
    RolloverTransaction,
    identitiesEquivalent
  });
});
