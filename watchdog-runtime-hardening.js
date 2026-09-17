(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_WATCHDOG_HARDENING_V2__";
  if (globalThis[FLAG]) return;
  globalThis[FLAG] = true;

  const originalQueryGenerationStatus = queryGenerationStatus;
  const caps = globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__ || null;

  function watchdogConversationMatches(side, status) {
    if (!caps || caps.version !== 1 || typeof caps.conversationIdentity !== "function") return false;
    const normalizedSide = String(side || "").toUpperCase();
    const tabId = Number(typeof tabForSide === "function" ? tabForSide(normalizedSide) : state?.[`tab${normalizedSide}`]);
    const expected = state?.viewpointIdentityBySide?.[normalizedSide] || null;
    const observed = caps.conversationIdentity({
      side: normalizedSide,
      tabId,
      url: String(status?.pageUrl || "")
    });
    if (!expected || !observed) return false;
    return String(expected.provenanceId || "") === String(observed.provenanceId || "") &&
      String(expected.threadKey || "") === String(observed.threadKey || "") &&
      String(expected.providerFamily || "") === String(observed.familyId || "") &&
      Number(expected.boundTabId) === Number(observed.tabId);
  }

  async function pauseForConversationAuthorityLoss(side, generationId) {
    const normalizedSide = String(side || "").toUpperCase();
    const expectedGeneration = String(generationId || "");
    if (!normalizedSide || String(state.generationIdBySide?.[normalizedSide] || "") !== expectedGeneration) {
      return { stale: true };
    }

    state.generationIdBySide = { ...(state.generationIdBySide || {}) };
    state.generationIdBySide[normalizedSide] = null;

    if (state.viewpointIdentityBySide && typeof state.viewpointIdentityBySide === "object") {
      const identities = { ...state.viewpointIdentityBySide };
      delete identities[normalizedSide];
      state.viewpointIdentityBySide = identities;
    }

    if (typeof isBatchWorkMode === "function" && isBatchWorkMode() && Array.isArray(state.phasePendingSides) && state.phasePendingSides.includes(normalizedSide)) {
      state.phaseSentSides = Array.isArray(state.phaseSentSides)
        ? state.phaseSentSides.filter(item => item !== normalizedSide)
        : [];
      if (state.lastResponseBySide && typeof state.lastResponseBySide === "object") {
        delete state.lastResponseBySide[normalizedSide];
      }
    }

    if (String(state.checkpointRequestId || "") === expectedGeneration) {
      state.checkpointPending = false;
      state.checkpointRequestId = null;
      state.postCheckpointResume = null;
    }

    try {
      if (typeof completeRoundTimer === "function") completeRoundTimer(normalizedSide);
    } catch (_) {}

    const reason = `AI ${normalizedSide} moved to a different provider conversation while its turn was active. The old turn was revoked. Resume or use Manual Relay after confirming the intended thread.`;
    await pauseBridge(reason);
    return { conversationMismatch: true, paused: true, revokedGeneration: true };
  }

  function expectedWatchdogSides() {
    if (!state?.sessionActive || !state?.running || state?.awaitingHuman) return [];
    if (isBatchWorkMode()) {
      return [...new Set((state.phasePendingSides || []).filter(side => SIDES.includes(side)))];
    }
    return SIDES.includes(state.currentSide) ? [state.currentSide] : [];
  }

  // `pendingSend` is a short handoff/upload transition, not proof that the
  // provider is actively generating model output.
  queryGenerationStatus = async function hardenedQueryGenerationStatus(side) {
    const status = await originalQueryGenerationStatus(side);
    if (!status || typeof status !== "object") return status;
    if (status.pendingSend === true && status.generating === true) {
      return { ...status, generating: false, sending: true };
    }
    return status;
  };

  async function probeExpectedSides(sides) {
    const entries = await Promise.all(sides.map(async side => {
      const status = await queryGenerationStatus(side);
      return [side, status];
    }));
    return Object.fromEntries(entries);
  }

  /**
   * Watchdog provider probes happen outside the coordinator mutation queue.
   * Once probing completes, all state reads that decide recovery and every
   * recovery mutation execute on the same queue as AI_BRIDGE_RESPONSE and the
   * rest of the control plane. This prevents an alarm tick from racing a late
   * response commit.
   */
  runWatchdogTick = async function hardenedRunWatchdogTick(now = Date.now()) {
    const initialSides = expectedWatchdogSides();
    if (!initialSides.length) {
      if (!state.sessionActive || !state.running || state.awaitingHuman) {
        return { checked: false };
      }
      return { checked: true, results: [] };
    }

    const generationSnapshot = Object.fromEntries(initialSides.map(side => [
      side,
      String(state.generationIdBySide?.[side] || "")
    ]));

    // tabs.sendMessage can be slow. Never hold the coordinator queue while
    // waiting for provider pages to answer a status probe.
    const statusBySide = await probeExpectedSides(initialSides);

    if (typeof globalThis.enqueueCoordinatorMutation !== "function") {
      throw new Error("AI Bridge coordinator mutation queue is unavailable to watchdog recovery.");
    }

    return globalThis.enqueueCoordinatorMutation(async () => {
      if (!state.sessionActive || !state.running || state.awaitingHuman) {
        return { checked: false };
      }

      // Re-evaluate mode/side ownership after the asynchronous probes. A turn
      // may have completed while the provider tabs were being queried.
      const currentExpected = new Set(expectedWatchdogSides());
      const sides = initialSides.filter(side =>
        currentExpected.has(side) &&
        String(state.generationIdBySide?.[side] || "") === generationSnapshot[side]
      );
      if (!sides.length) return { checked: true, results: [] };

      const timeoutMs = clampStuckTimeoutMinutes(state.stuckTimeoutMinutes) * 60 * 1000;
      const results = [];

      for (const side of sides) {
        const status = statusBySide[side];

        // A provider SPA can keep the same content script alive while moving to
        // another conversation. Such a page may still look actively generating,
        // but Generation Security v5 will reject its eventual response. Detect
        // that authority loss immediately instead of waiting for the stuck timer.
        if (!watchdogConversationMatches(side, status)) {
          const revoked = await pauseForConversationAuthorityLoss(side, generationSnapshot[side]);
          results.push({ side, ...revoked });
          if (revoked?.paused) break;
          continue;
        }

        const startedAt = Number(state.roundStartedAtBySide?.[side]);
        if (!Number.isFinite(startedAt) || startedAt <= 0) continue;

        const lastChangeAt = Number(status?.lastChangeAt) || 0;
        state.lastProgressAtBySide = { A: null, B: null, C: null, ...(state.lastProgressAtBySide || {}) };
        if (lastChangeAt > Number(state.lastProgressAtBySide[side] || 0)) {
          state.lastProgressAtBySide[side] = lastChangeAt;
          await saveState();
        }

        const progressing = Boolean(status?.generating) && lastChangeAt > 0 && (Number(now) - lastChangeAt) < timeoutMs;
        if (progressing) {
          results.push({ side, progressing: true });
          continue;
        }

        if (!shouldDeclareStuck({
          startedAt,
          lastProgressAt: state.lastProgressAtBySide[side],
          now,
          timeoutMs
        })) {
          results.push({ side, stuck: false });
          continue;
        }

        // Re-check generation immediately before committing recovery. This is
        // intentionally redundant with the queue-entry validation above.
        if (String(state.generationIdBySide?.[side] || "") !== generationSnapshot[side]) {
          results.push({ side, stale: true });
          continue;
        }

        if (state.checkpointPending && generationMatches(
          state.checkpointRequestId || state.generationIdBySide?.[side],
          state.generationIdBySide?.[side]
        )) {
          await skipStalledCheckpoint(side);
          results.push({ side, checkpointSkipped: true });
          continue;
        }

        const recovered = await recoverStuckSide(side);
        results.push({ side, stuck: true, ...recovered });
      }

      return { checked: true, results };
    });
  };

  globalThis.__AI_BRIDGE_WATCHDOG_SECURITY__ = Object.freeze({
    version: 3,
    expectedSides: expectedWatchdogSides,
    pendingSendCountsAsModelProgress: false,
    serializedWithCoordinator: true,
    mutatesActiveSides: false,
    generationStatusCarriesPageIdentity: true,
    revokesMismatchedConversationBeforeTimeout: true,
    neverAutoTrustsNavigatedConversation: true
  });
})();
