(() => {
  "use strict";

  // AI_BRIDGE_RESPONSE is the message that advances the coordinator. A
  // transient Manifest V3 service-worker restart must never turn a completed
  // model answer into a permanently lost turn. This wrapper sits outside
  // content-completion-guard.js and only changes response delivery; every other
  // runtime message keeps Chrome's native behavior.
  const HARDENING_VERSION = "1.16.3";
  const FLAG = "__AI_BRIDGE_RESPONSE_DELIVERY_HARDENING_V1163__";
  if (window[FLAG]) return;
  window[FLAG] = true;

  // content-completion-guard.js loads first, so this captures its guarded
  // sendMessage implementation and preserves all stale-response semantics.
  const originalSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
  const inFlight = new Map();
  const settled = new Map();
  const latestByGeneration = new Map();
  const MAX_TRACKED = 64;
  const INITIAL_RETRY_MS = 250;
  const MAX_RETRY_MS = 5000;

  function responseMessageFromArgs(args) {
    if (args.length !== 1) return null;
    const message = args[0];
    if (!message || typeof message !== "object" || message.type !== "AI_BRIDGE_RESPONSE") return null;
    return message;
  }

  function responseKey(message) {
    const generationId = String(message.generationId || "legacy");
    const completedAt = Number(message.completedAt) || 0;
    const text = String(message.text || "");
    return `${generationId}\u0000${completedAt}\u0000${text}`;
  }

  function generationKey(message) {
    return String(message.generationId || "legacy");
  }

  function rememberBounded(map, key, value) {
    map.delete(key);
    map.set(key, value);
    while (map.size > MAX_TRACKED) {
      map.delete(map.keys().next().value);
    }
  }

  function rememberSettled(key, result) {
    rememberBounded(settled, key, result);
  }

  function rememberLatest(generationId, value) {
    rememberBounded(latestByGeneration, generationId, value);
  }

  function isAcknowledgement(result) {
    // Background and completion-guard terminal responses are structured
    // objects. undefined/null means there was no receiver acknowledgement and
    // must be retried rather than silently treated as delivered.
    return Boolean(result && typeof result === "object");
  }

  function extensionContextInvalidated(error) {
    return /extension context invalidated/i.test(String(error?.message || error || ""));
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function supersedeOlder(message, newKey) {
    const generationId = generationKey(message);
    const completedAt = Number(message.completedAt) || 0;
    const previous = latestByGeneration.get(generationId);

    // A late monitor invocation can finish artifact capture after a newer DOM
    // state has already been delivered. Never allow that older payload to be
    // sent after the newer response.
    if (previous && completedAt && previous.completedAt && completedAt < previous.completedAt) {
      return {
        stale: true,
        result: { ok: false, ignored: true, superseded: true, staleDelivery: true }
      };
    }

    if (!previous || completedAt > previous.completedAt || (completedAt === previous.completedAt && previous.key !== newKey)) {
      rememberLatest(generationId, { key: newKey, completedAt });
    }

    for (const [key, entry] of inFlight.entries()) {
      if (key === newKey || entry.generationId !== generationId) continue;
      if (completedAt && entry.completedAt && entry.completedAt > completedAt) continue;

      entry.superseded = true;
      const terminal = { ok: false, ignored: true, superseded: true, staleDelivery: true };
      if (!entry.settled) {
        entry.settled = true;
        rememberSettled(key, terminal);
        entry.resolve(terminal);
      }
      inFlight.delete(key);
    }

    return { stale: false, result: null };
  }

  async function deliver(entry) {
    let retryMs = INITIAL_RETRY_MS;
    while (!entry.superseded) {
      try {
        const result = await originalSendMessage(entry.message);
        if (entry.superseded) return;
        if (isAcknowledgement(result)) {
          if (!entry.settled) {
            entry.settled = true;
            rememberSettled(entry.key, result);
            entry.resolve(result);
          }
          inFlight.delete(entry.key);
          return;
        }
      } catch (error) {
        if (entry.superseded) return;

        // Once Chrome invalidates the old content-script context, retries from
        // that context cannot succeed. Reject so the service worker's listener
        // recovery can reinject a fresh script, which resets content.js state.
        if (extensionContextInvalidated(error)) {
          if (!entry.settled) {
            entry.settled = true;
            entry.reject(error);
          }
          inFlight.delete(entry.key);
          return;
        }
      }

      // Receiving-end/port failures are normally transient during MV3 worker
      // startup/restart. Retry with bounded exponential backoff. Different
      // response signatures are not blocked by this wait.
      await sleep(retryMs);
      retryMs = Math.min(MAX_RETRY_MS, retryMs * 2);
    }
  }

  chrome.runtime.sendMessage = function hardenedSendMessage(...args) {
    const message = responseMessageFromArgs(args);
    if (!message) return originalSendMessage(...args);

    const key = responseKey(message);
    if (settled.has(key)) return Promise.resolve(settled.get(key));
    if (inFlight.has(key)) return inFlight.get(key).promise;

    const supersession = supersedeOlder(message, key);
    if (supersession.stale) {
      rememberSettled(key, supersession.result);
      return Promise.resolve(supersession.result);
    }

    let resolveEntry;
    let rejectEntry;
    const promise = new Promise((resolve, reject) => {
      resolveEntry = resolve;
      rejectEntry = reject;
    });
    const entry = {
      key,
      message,
      generationId: generationKey(message),
      completedAt: Number(message.completedAt) || 0,
      promise,
      resolve: resolveEntry,
      reject: rejectEntry,
      settled: false,
      superseded: false
    };

    inFlight.set(key, entry);
    void deliver(entry);
    return promise;
  };

  // Exposed only inside the extension's isolated content-script world for
  // diagnostics. This does not widen page or host permissions.
  window.__AI_BRIDGE_RESPONSE_DELIVERY_STATUS__ = () => ({
    version: HARDENING_VERSION,
    inFlight: inFlight.size,
    settled: settled.size,
    generations: latestByGeneration.size
  });
})();
