(() => {
  "use strict";

  // A provider page can briefly keep its previous assistant response in the DOM
  // after AI Bridge submits a new prompt. content.js deliberately clears its
  // observation cache for each generation, so that old response can otherwise
  // look like a brand-new, already-stable completion if the provider's Stop
  // control is late, hidden, or has changed markup.
  //
  // Keep this guard in the service worker as defense in depth. We remember the
  // previous completed response before sendToSide() clears its duplicate guard,
  // then reject only the very narrow signature of the stale-DOM race:
  //   1. same side and generation,
  //   2. exact same text as the immediately previous completed response, and
  //   3. content.js says the last text change happened essentially at prompt
  //      submission time (within the monitor's first polling interval).
  // A real repeated answer remains valid once it has actually had time to be
  // generated, preserving backwards compatibility for deterministic models.

  const STALE_BASELINE_WINDOW_MS = 1200;
  const MAX_BASELINE_RECORDS = 24;

  function aiBridgeLooksLikeStaleBaseline({ previousText, incomingText, startedAt, completedAt }) {
    const previous = String(previousText || "");
    const incoming = String(incomingText || "");
    if (!previous || incoming !== previous) return false;

    const start = Number(startedAt);
    const completed = Number(completedAt);
    if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(completed) || completed <= 0) return false;

    // sendPrompt() timestamps its DOM observation just before sendToSide()
    // starts the round timer, so a stale baseline can be a few milliseconds
    // before or after startedAt. Genuine completions are expected later.
    return Math.abs(completed - start) <= STALE_BASELINE_WINDOW_MS;
  }

  if (typeof sendToSide !== "function" || typeof handleCompletedResponse !== "function") {
    console.warn("AI Bridge completion hardening could not attach to background runtime");
    return;
  }

  const baselineByGeneration = new Map();

  function rememberBaseline(generationId, record) {
    const id = String(generationId || "");
    if (!id) return;
    baselineByGeneration.set(id, record);
    while (baselineByGeneration.size > MAX_BASELINE_RECORDS) {
      baselineByGeneration.delete(baselineByGeneration.keys().next().value);
    }
  }

  const baseSendToSide = sendToSide;
  sendToSide = async function hardenedSendToSide(side, text, options = {}) {
    const previousText = String(state?.lastResponseBySide?.[side] || "");
    const result = await baseSendToSide(side, text, options);
    const generationId = String(state?.generationIdBySide?.[side] || "");
    const startedAt = Number(state?.roundStartedAtBySide?.[side]) || Date.now();
    rememberBaseline(generationId, { side, previousText, startedAt });
    return result;
  };

  const baseHandleCompletedResponse = handleCompletedResponse;
  handleCompletedResponse = async function hardenedHandleCompletedResponse(side, text, options = {}) {
    const generationId = String(options?.generationId || "");
    const baseline = baselineByGeneration.get(generationId);

    if (baseline && baseline.side === side && aiBridgeLooksLikeStaleBaseline({
      previousText: baseline.previousText,
      incomingText: text,
      startedAt: baseline.startedAt,
      completedAt: options?.completedAt
    })) {
      // Do not consume the baseline record here. The real response for this
      // generation may arrive moments later with different text and must pass.
      try {
        appendLog({
          time: Date.now(),
          type: "stale-baseline-response",
          side,
          text: `Ignored previous AI ${side} response that was re-observed immediately after a new prompt`
        });
      } catch (_) {}
      return { ok: false, ignored: true, staleBaseline: true };
    }

    if (generationId) baselineByGeneration.delete(generationId);
    return baseHandleCompletedResponse(side, text, options);
  };
})();
