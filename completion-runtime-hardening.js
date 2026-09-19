(() => {
  "use strict";

  // Provider pages can briefly keep the previous assistant response as the
  // newest visible response after AI Bridge submits a new prompt. The content
  // completion guard fixes that at the source by comparing DOM identity, while
  // this service-worker layer both requires that guard and retains a narrow
  // timestamp fallback for defense in depth.

  const MAX_BASELINE_RECORDS = 24;
  const GUARD_FILE = "content-completion-guard.js";
  const GUARD_VERSION = "1.16.3";
  const GUARD_STATUS_MESSAGE = "AI_BRIDGE_COMPLETION_GUARD_STATUS";
  const GUARD_CANCEL_MESSAGE = "AI_BRIDGE_CANCEL_COMPLETION_HOLDS";

  function aiBridgeLooksLikeStaleBaseline({ previousText, incomingText, startedAt, completedAt }) {
    const previous = String(previousText || "");
    const incoming = String(incomingText || "");
    if (!previous || incoming !== previous) return false;

    const start = Number(startedAt);
    const completed = Number(completedAt);
    if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(completed) || completed <= 0) return false;

    // content.js resets lastChangeAt before AI_BRIDGE_SEND resolves; background
    // starts the round timer only after that acknowledgement. Therefore an old
    // baseline has a completion timestamp strictly before the new round start.
    // A genuine fast repeated answer observed after submission must not be
    // rejected merely because it arrived within an arbitrary time window.
    return completed < start;
  }

  if (typeof sendToSide !== "function" ||
      typeof handleCompletedResponse !== "function" ||
      typeof ensureTabListener !== "function") {
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

  function liveSidesForCompletionHolds() {
    const roster = typeof SIDES === "undefined" ? null : SIDES;
    if (Array.isArray(roster) && roster.length) return [...roster];
    const dynamic = globalThis.__AI_BRIDGE_DYNAMIC_AGENTS_V1__;
    if (typeof dynamic?.liveSides === "function") return [...dynamic.liveSides()];
    return ["A", "B", "C"];
  }

  async function cancelProviderCompletionHolds(reason = "bridge-paused-or-stopped") {
    baselineByGeneration.clear();
    const tasks = liveSidesForCompletionHolds().map(async side => {
      const tabId = Number(state?.[`tab${side}`]);
      if (!Number.isInteger(tabId) || tabId <= 0) return;
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: GUARD_CANCEL_MESSAGE,
          reason: String(reason || "bridge-paused-or-stopped").slice(0, 120)
        });
      } catch (_) {
        // A closing/reloading provider tab has no hold worth preserving.
      }
    });
    await Promise.all(tasks);
  }

  // Require the DOM-identity guard on every provider tab. Manifest loading
  // covers fresh navigations; explicit reinjection covers tabs that were open
  // while the extension updated. If Chrome refuses the guard, fail closed
  // instead of running with known-brittle completion detection.
  const baseEnsureTabListener = ensureTabListener;
  ensureTabListener = async function hardenedEnsureTabListener(tabId) {
    const result = await baseEnsureTabListener(tabId);
    try {
      await chrome.scripting.executeScript({ target: { tabId: Number(tabId) }, files: [GUARD_FILE] });
      const status = await chrome.tabs.sendMessage(Number(tabId), { type: GUARD_STATUS_MESSAGE });
      if (!status?.ok || !status?.patched || status?.version !== GUARD_VERSION) {
        const detail = status?.version && status.version !== GUARD_VERSION
          ? `completion guard version ${status.version} does not match required ${GUARD_VERSION}`
          : (status?.error || "completion guard did not attach");
        throw new Error(detail);
      }
    } catch (err) {
      throw new Error(`Completion guard could not be established (${err?.message || "unknown error"}). Refresh the AI tab once.`);
    }
    return result;
  };

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
      try {
        appendLog({
          time: Date.now(),
          type: "stale-baseline-response",
          side,
          text: `Ignored previous AI ${side} response that was re-observed before the new round timer started`
        });
      } catch (_) {}
      return { ok: false, ignored: true, staleBaseline: true };
    }

    if (generationId) baselineByGeneration.delete(generationId);
    return baseHandleCompletedResponse(side, text, options);
  };

  // Pause/Stop are explicit lifecycle boundaries. A special stale-baseline
  // hold must never surface later as a completion after the operator has paused
  // or ended the run. Normal responses that already reached the background keep
  // the core runtime's existing capture-while-paused semantics.
  if (typeof pauseBridge === "function") {
    const basePauseBridge = pauseBridge;
    pauseBridge = async function hardenedPauseBridge(...args) {
      await cancelProviderCompletionHolds("bridge-paused");
      return basePauseBridge(...args);
    };
  }

  if (typeof endBridge === "function") {
    const baseEndBridge = endBridge;
    endBridge = async function hardenedEndBridge(...args) {
      await cancelProviderCompletionHolds("bridge-ended");
      return baseEndBridge(...args);
    };
  }
})();
