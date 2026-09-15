(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_WATCHDOG_HARDENING_V1__";
  if (globalThis[FLAG]) return;
  globalThis[FLAG] = true;

  const originalRunWatchdogTick = runWatchdogTick;
  const originalQueryGenerationStatus = queryGenerationStatus;

  function expectedWatchdogSides() {
    if (!state?.sessionActive || !state?.running || state?.awaitingHuman) return [];
    if (isBatchWorkMode()) {
      return [...new Set((state.phasePendingSides || []).filter(side => SIDES.includes(side)))];
    }
    return SIDES.includes(state.currentSide) ? [state.currentSide] : [];
  }

  // `pendingSend` is the short local handoff/upload transition, not proof that
  // a provider is actively generating model output. Keep it visible for
  // diagnostics, but do not let that flag alone refresh the watchdog's model-
  // progress decision.
  queryGenerationStatus = async function hardenedQueryGenerationStatus(side) {
    const status = await originalQueryGenerationStatus(side);
    if (!status || typeof status !== "object") return status;
    if (status.pendingSend === true && status.generating === true) {
      return { ...status, generating: false, sending: true };
    }
    return status;
  };

  runWatchdogTick = async function hardenedRunWatchdogTick(now = Date.now()) {
    const expected = expectedWatchdogSides();
    if (!expected.length) {
      if (!state.sessionActive || !state.running || state.awaitingHuman) {
        return { checked: false };
      }
      return { checked: true, results: [] };
    }

    // The legacy implementation iterates state.activeSides. Temporarily narrow
    // only that view while the tick runs, then restore the user's configured
    // team membership even when recovery throws.
    const configuredActiveSides = state.activeSides;
    state.activeSides = expected;
    try {
      return await originalRunWatchdogTick(now);
    } finally {
      state.activeSides = configuredActiveSides;
    }
  };

  globalThis.__AI_BRIDGE_WATCHDOG_SECURITY__ = Object.freeze({
    version: 1,
    expectedSides: expectedWatchdogSides,
    pendingSendCountsAsModelProgress: false
  });
})();
