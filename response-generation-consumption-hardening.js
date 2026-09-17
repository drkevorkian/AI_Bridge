(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_RESPONSE_GENERATION_CONSUMPTION_V1__";
  if (globalThis[FLAG]) return;

  if (typeof handleCompletedResponse !== "function" || typeof generationMatches !== "function") {
    throw new Error("AI Bridge response-generation consumption loaded before coordinator generation support.");
  }

  const baseHandleCompletedResponse = handleCompletedResponse;

  // The background listener performs an early generation check before placing a
  // response into responseCommitQueue. Two deliveries can pass that early check
  // before either commits, so generation authority must be rechecked here at the
  // serialized commit boundary. Consume the accepted token before any response
  // processing can advance the coordinator cursor or wait before the next send.
  handleCompletedResponse = async function hardenedHandleCompletedResponse(side, text, options = {}) {
    const normalizedSide = String(side || "").toUpperCase();
    const incomingGenerationId = String(options?.generationId || "");
    const expectedGenerationId = String(state?.generationIdBySide?.[normalizedSide] || "");

    if (!generationMatches(expectedGenerationId, incomingGenerationId)) {
      try {
        appendLog({
          time: Date.now(),
          type: "stale-response",
          side: normalizedSide || null,
          text: `Ignored response from AI ${normalizedSide || "?"} because its generation was no longer armed at serialized commit`
        });
      } catch (_) {}
      return { ok: false, ignored: true, staleGeneration: true };
    }

    // One accepted provider response consumes exactly one armed generation.
    // Clear before delegating so a duplicate queued behind this response cannot
    // be accepted during sequential delay/cursor transitions. A fresh dispatch
    // may arm a newer generation inside the delegated handler; never clear after
    // delegation or that newer token could be destroyed.
    state.generationIdBySide = {
      ...(state.generationIdBySide && typeof state.generationIdBySide === "object" ? state.generationIdBySide : {}),
      [normalizedSide]: null
    };

    return baseHandleCompletedResponse(side, text, options);
  };

  globalThis[FLAG] = Object.freeze({
    version: 1,
    rechecksGenerationAtSerializedCommit: true,
    consumesAcceptedGenerationBeforeCommit: true,
    preservesNewerGenerationArmedByCommit: true,
    preventsSequentialReplayWindow: true
  });
})();
