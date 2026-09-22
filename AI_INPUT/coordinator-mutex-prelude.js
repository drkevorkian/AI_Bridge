(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_COORDINATOR_MUTEX_PRELUDE_V5__";
  if (globalThis[FLAG]) return;
  globalThis[FLAG] = true;

  const serializedTypes = new Set([
    "AI_BRIDGE_START",
    "AI_BRIDGE_PAUSE",
    "AI_BRIDGE_RESUME",
    "AI_BRIDGE_STOP",
    "AI_BRIDGE_RESEND",
    "AI_BRIDGE_FORCE_RELAY",
    "AI_BRIDGE_INTERJECT",
    "AI_BRIDGE_SET_TEAM_RULES",
    "AI_BRIDGE_HUMAN_REOPEN",
    "AI_BRIDGE_HUMAN_SUPPRESS",
    "AI_BRIDGE_HUMAN_REPLY",
    "AI_BRIDGE_RESPONSE"
  ]);

  let queue = Promise.resolve();
  let active = 0;
  const originalAddListener = chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage);
  const originalTabRemovedAddListener = chrome.tabs?.onRemoved?.addListener
    ? chrome.tabs.onRemoved.addListener.bind(chrome.tabs.onRemoved)
    : null;

  function enqueueCoordinatorMutation(task) {
    if (typeof task !== "function") {
      return Promise.reject(new TypeError("Coordinator mutation task must be a function."));
    }

    const result = queue.catch(() => {}).then(async () => {
      active += 1;
      try {
        return await task();
      } finally {
        active = Math.max(0, active - 1);
      }
    });

    queue = result.then(() => undefined, () => undefined);
    return result;
  }

  function runSerialized(listener, message, sender, sendResponse) {
    return enqueueCoordinatorMutation(() => new Promise((resolve, reject) => {
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        resolve();
      };
      const wrappedSendResponse = value => {
        try {
          sendResponse(value);
        } finally {
          release();
        }
      };

      try {
        const listenerResult = listener(message, sender, wrappedSendResponse);
        if (listenerResult !== true) release();
      } catch (error) {
        reject(error);
      }
    }));
  }

  function boundSideForSender(sender) {
    const tabId = Number(sender?.tab?.id);
    if (!Number.isInteger(tabId)) return null;
    try {
      if (Number(state?.tabA) === tabId) return "A";
      if (Number(state?.tabB) === tabId) return "B";
      if (Number(state?.tabC) === tabId) return "C";
    } catch (_) {}
    return null;
  }

  function validateArtifactFetchRequest(message, sender) {
    if (message?.type !== "AI_BRIDGE_FETCH_ARTIFACT") return { ok: true };
    if (message.observed !== true) return { ok: false, error: "Artifact fallback requires a DOM-observed candidate." };

    const side = boundSideForSender(sender);
    if (!side) return { ok: false, error: "Artifact fallback sender is not a bound AI tab." };

    const generationId = String(message.generationId || "");
    if (!generationId || generationId.length > 160 || !/^[A-C]-\d{6,}-[a-z0-9_-]{4,80}$/i.test(generationId)) {
      return { ok: false, error: "Artifact fallback is missing a valid generation ID." };
    }

    try {
      const expected = String(state?.generationIdBySide?.[side] || "");
      if (!expected || expected !== generationId) {
        return { ok: false, error: "Artifact fallback generation is stale or does not match the bound AI turn." };
      }
    } catch (_) {
      return { ok: false, error: "Artifact fallback generation state is unavailable." };
    }

    const urlText = String(message.url || "");
    let parsed;
    try { parsed = new URL(urlText); } catch (_) {
      return { ok: false, error: "Artifact fallback URL is invalid." };
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) {
      return { ok: false, error: "Artifact fallback requires credential-free standard-port HTTPS." };
    }

    const signature = String(message.candidateSignature || "");
    if (!signature || signature.length > 2048 || !signature.startsWith(`${urlText}|`)) {
      return { ok: false, error: "Artifact fallback candidate signature is missing or malformed." };
    }
    if (String(message.name || "").length > 240 || String(message.mime || "").length > 160) {
      return { ok: false, error: "Artifact fallback metadata exceeds its allowed bounds." };
    }
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener = function hardenedAddListener(listener) {
    if (typeof listener !== "function") return originalAddListener(listener);
    return originalAddListener((message, sender, sendResponse) => {
      const artifactGate = validateArtifactFetchRequest(message, sender);
      if (!artifactGate.ok) {
        sendResponse({ ok: false, error: artifactGate.error, rejectedBy: "artifact-provenance-gate" });
        return false;
      }

      if (!serializedTypes.has(String(message?.type || ""))) {
        return listener(message, sender, sendResponse);
      }
      runSerialized(listener, message, sender, sendResponse).catch(error => {
        console.error("AI Bridge coordinator mutation failed", error);
      });
      return true;
    });
  };

  if (originalTabRemovedAddListener) {
    chrome.tabs.onRemoved.addListener = function hardenedTabRemovedAddListener(listener) {
      if (typeof listener !== "function") return originalTabRemovedAddListener(listener);
      return originalTabRemovedAddListener((tabId, removeInfo) => {
        enqueueCoordinatorMutation(() => listener(tabId, removeInfo)).catch(error => {
          console.error("AI Bridge tab-removal mutation failed", error);
        });
      });
    };
  }

  globalThis.enqueueCoordinatorMutation = enqueueCoordinatorMutation;

  globalThis.__AI_BRIDGE_COORDINATOR_MUTEX__ = Object.freeze({
    version: 5,
    enqueue: enqueueCoordinatorMutation,
    isSerializedType(type) { return serializedTypes.has(String(type || "")); },
    artifactProvenanceGate: true,
    get active() { return active; }
  });
})();
