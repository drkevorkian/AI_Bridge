(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_WATCHDOG_HARDENING_V2__";
  if (globalThis[FLAG]) return;
  globalThis[FLAG] = true;

  const originalQueryGenerationStatus = queryGenerationStatus;

  function expectedWatchdogSides() {
    if (!state?.sessionActive || !state?.running || state?.awaitingHuman) return [];
    if (isBatchWorkMode()) {
      return [...new Set((state.phasePendingSides || []).filter(side => SIDES.includes(side)))];
    }
    return SIDES.includes(state.currentSide) ? [state.currentSide] : [];
  }

  function snapshotForSide(side) {
    return {
      side,
      generationId: String(state.generationIdBySide?.[side] || ""),
      startedAt: Number(state.roundStartedAtBySide?.[side]) || 0,
      lastProgressAt: Number(state.lastProgressAtBySide?.[side]) || 0
    };
  }

  function sideStillExpected(side) {
    return expectedWatchdogSides().includes(side);
  }

  // `pendingSend` is a short local upload/handoff transition, not evidence that
  // the model is actively producing output. Preserve it as a diagnostic field
  // while keeping the watchdog's progress calculation conservative.
  queryGenerationStatus = async function hardenedQueryGenerationStatus(side) {
    const status = await originalQueryGenerationStatus(side);
    if (!status || typeof status !== "object") return status;
    if (status.pendingSend === true && status.generating === true) {
      return { ...status, generating: false, sending: true };
    }
    return status;
  };

  /**
   * Probe provider pages outside the coordinator mutation queue.  tabs messaging
   * can be slow and must not stall START/STOP/RESPONSE handling merely to learn
   * whether a model is still generating.
   */
  async function collectProviderProbes(snapshots) {
    const probes = new Map();
    await Promise.all(snapshots.map(async snapshot => {
      probes.set(snapshot.side, await queryGenerationStatus(snapshot.side));
    }));
    return probes;
  }

  runWatchdogTick = async function hardenedRunWatchdogTick(now = Date.now()) {
    if (typeof globalThis.enqueueCoordinatorMutation !== "function") {
      throw new Error("AI Bridge coordinator mutation queue is unavailable to watchdog.");
    }

    // Take a tiny serialized snapshot so a control-plane mutation cannot split
    // the watchdog's initial view of currentSide/generation/timer state.
    const snapshots = await globalThis.enqueueCoordinatorMutation(() => {
      const expected = expectedWatchdogSides();
      if (!expected.length) return [];
      return expected.map(snapshotForSide);
    });

    if (!snapshots.length) {
      return globalThis.enqueueCoordinatorMutation(() => ({
        checked: Boolean(state.sessionActive && state.running && !state.awaitingHuman),
        results: []
      }));
    }

    // This is the deliberately unlocked portion of the watchdog.
    const probes = await collectProviderProbes(snapshots);

    // Re-enter the exact same queue used by AI_BRIDGE_RESPONSE and every other
    // coordinator mutation.  Revalidate all state derived before the provider
    // probes; stale probe results are ignored rather than committed.
    return globalThis.enqueueCoordinatorMutation(async () => {
      if (!state.sessionActive || !state.running || state.awaitingHuman) {
        return { checked: false, results: [] };
      }

      const timeoutMs = clampStuckTimeoutMinutes(state.stuckTimeoutMinutes) * 60 * 1000;
      const results = [];

      for (const snapshot of snapshots) {
        const side = snapshot.side;
        if (!sideStillExpected(side)) {
          results.push({ side, staleProbe: true });
          continue;
        }

        const currentGenerationId = String(state.generationIdBySide?.[side] || "");
        const currentStartedAt = Number(state.roundStartedAtBySide?.[side]) || 0;
        if (currentGenerationId !== snapshot.generationId || currentStartedAt !== snapshot.startedAt) {
          results.push({ side, staleProbe: true });
          continue;
        }
        if (!Number.isFinite(currentStartedAt) || currentStartedAt <= 0) continue;

        const status = probes.get(side);
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
          startedAt: currentStartedAt,
          lastProgressAt: state.lastProgressAtBySide[side],
          now,
          timeoutMs
        })) {
          results.push({ side, stuck: false });
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

        // Recovery mutates several coupled coordinator fields and starts a new
        // generation.  Keep that commit serialized with RESPONSE/STOP/RESEND so
        // a late response can never observe or overwrite a half-applied recovery.
        const recovered = await recoverStuckSide(side);
        results.push({ side, stuck: true, ...recovered });
      }

      return { checked: true, results };
    });
  };

  globalThis.__AI_BRIDGE_WATCHDOG_SECURITY__ = Object.freeze({
    version: 2,
    expectedSides: expectedWatchdogSides,
    pendingSendCountsAsModelProgress: false,
    sharedCoordinatorQueue: true,
    mutatesActiveSidesForFiltering: false,
    providerProbeOutsideQueue: true
  });
})();
