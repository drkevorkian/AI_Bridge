(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_GENERATION_HARDENING_V1__";
  if (globalThis[FLAG]) return;
  globalThis[FLAG] = true;

  // Responses are valid only when both sides present the same non-empty
  // generation ID. During START/RESUME setup the coordinator therefore cannot
  // accidentally accept leftover DOM output from a previous generation.
  generationMatches = function hardenedGenerationMatches(expectedId, incomingId) {
    const expected = String(expectedId || "");
    const incoming = String(incomingId || "");
    return Boolean(expected && incoming && incoming === expected);
  };

  if (typeof handleCompletedResponse !== "function") {
    throw new Error("AI Bridge generation hardening loaded before response completion support.");
  }

  const baseHandleCompletedResponse = handleCompletedResponse;

  // The background listener performs an early generation check before placing a
  // response into responseCommitQueue. Two near-simultaneous deliveries can
  // both pass that early check before either commits. Re-check here because this
  // function is invoked by the serialized queue task, then consume the accepted
  // token before response processing can advance the cursor or wait for the next
  // dispatch. A duplicate queued behind it therefore fails closed.
  handleCompletedResponse = async function generationHardenedHandleCompletedResponse(side, text, options = {}) {
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

    // Consume before delegating. The delegated handler may eventually dispatch
    // another prompt to this same side and arm a newer generation; clearing only
    // after delegation could accidentally destroy that fresh token.
    state.generationIdBySide = {
      ...(state.generationIdBySide && typeof state.generationIdBySide === "object" ? state.generationIdBySide : {}),
      [normalizedSide]: null
    };

    return baseHandleCompletedResponse(side, text, options);
  };

  globalThis.__AI_BRIDGE_GENERATION_SECURITY__ = Object.freeze({
    version: 2,
    failClosedWhenUnarmed: true,
    rechecksGenerationAtSerializedCommit: true,
    consumesAcceptedGenerationBeforeCommit: true,
    preservesNewerGenerationArmedByCommit: true,
    preventsSequentialReplayWindow: true
  });
})();
