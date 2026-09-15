(() => {
  "use strict";

  // AI_BRIDGE_RESPONSE advances the coordinator. A transient Manifest V3
  // service-worker restart must not lose a completed answer, while a negative
  // coordinator reply must never be mistaken for successful delivery.
  const HARDENING_VERSION = "1.16.3-pr3";
  const FLAG = "__AI_BRIDGE_RESPONSE_DELIVERY_HARDENING_V1163__";
  if (window[FLAG]) return;
  window[FLAG] = true;

  // content-completion-guard.js loads first, so preserve its stale-response
  // semantics by capturing the already-guarded sendMessage implementation.
  const originalSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
  const inFlight = new Map();
  const settled = new Map();
  const latestByGeneration = new Map();
  const MAX_TRACKED = 64;
  const INITIAL_RETRY_MS = 250;
  const MAX_RETRY_MS = 5000;
  const MAX_ATTEMPTS = 10;

  function responseMessageFromArgs(args) {
    if (args.length !== 1) return null;
    const message = args[0];
    if (!message || typeof message !== "object" || message.type !== "AI_BRIDGE_RESPONSE") return null;
    return message;
  }

  function fastHash(value) {
    // Deterministic non-cryptographic identity only. This is not used for trust
    // or integrity decisions; it keeps delayed artifacts distinct in the
    // delivery de-duplication key without retaining their full base64 payload.
    const text = String(value || "");
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  function artifactSignature(message) {
    const artifacts = Array.isArray(message?.artifacts) ? message.artifacts : [];
    return artifacts.map((artifact, index) => [
      index,
      String(artifact?.name || ""),
      Number(artifact?.size) || 0,
      String(artifact?.mime || ""),
      fastHash(artifact?.dataBase64 || "")
    ].join(":"))
      .join("|");
  }

  function responseKey(message) {
    const generationId = String(message.generationId || "legacy");
    const completedAt = Number(message.completedAt) || 0;
    const text = String(message.text || "");
    return `${generationId}\u0000${completedAt}\u0000${text}\u0000${artifactSignature(message)}`;
  }

  function generationKey(message) {
    return String(message.generationId || "legacy");
  }

  function rememberBounded(map, key, value) {
    map.delete(key);
    map.set(key, value);
    while (map.size > MAX_TRACKED) map.delete(map.keys().next().value);
  }

  function rememberSettled(key, result) {
    rememberBounded(settled, key, result);
  }

  function rememberLatest(generationId, value) {
    rememberBounded(latestByGeneration, generationId, value);
  }

  function isIntentionalTerminal(result) {
    if (!result || typeof result !== "object" || result.ok !== false) return false;
    return Boolean(
      result.ignored || result.superseded || result.stale || result.staleDelivery ||
      result.cancelled || result.expired || result.duplicate || result.stopped
    );
  }

  function classifyResult(result) {
    if (result && typeof result === "object" && result.ok === true) return "committed";
    if (isIntentionalTerminal(result)) return "terminal";
    return "retry";
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

  function failEntry(entry, error) {
    if (!entry.settled) {
      entry.settled = true;
      entry.reject(error instanceof Error ? error : new Error(String(error || "Response delivery failed.")));
    }
    inFlight.delete(entry.key);
  }

  async function deliver(entry) {
    let retryMs = INITIAL_RETRY_MS;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !entry.superseded; attempt++) {
      try {
        const result = await originalSendMessage(entry.message);
        if (entry.superseded) return;
        const classification = classifyResult(result);
        if (classification === "committed" || classification === "terminal") {
          if (!entry.settled) {
            entry.settled = true;
            rememberSettled(entry.key, result);
            entry.resolve(result);
          }
          inFlight.delete(entry.key);
          return;
        }
        const detail = result?.error || (result?.awaitingHuman ? "coordinator is awaiting human input" : "receiver did not commit the response");
        lastError = new Error(`AI Bridge response not committed: ${detail}`);
      } catch (error) {
        if (entry.superseded) return;
        lastError = error;
        if (extensionContextInvalidated(error)) {
          failEntry(entry, error);
          return;
        }
      }

      if (attempt < MAX_ATTEMPTS) {
        await sleep(retryMs);
        retryMs = Math.min(MAX_RETRY_MS, retryMs * 2);
      }
    }

    if (!entry.superseded) {
      failEntry(entry, lastError || new Error("AI Bridge response delivery retry budget exhausted."));
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

  window.__AI_BRIDGE_RESPONSE_DELIVERY_STATUS__ = () => ({
    version: HARDENING_VERSION,
    inFlight: inFlight.size,
    settled: settled.size,
    generations: latestByGeneration.size,
    maxAttempts: MAX_ATTEMPTS
  });
})();
