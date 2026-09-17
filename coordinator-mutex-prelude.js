(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_COORDINATOR_MUTEX_PRELUDE_V6__";
  if (globalThis[FLAG]) return;
  globalThis[FLAG] = true;

  // agent-capabilities.js is loaded before this prelude by background-wrapper.
  // Keep the A/B/C fallback only so this security prelude remains testable and
  // backwards-compatible when evaluated in isolation by older regression
  // harnesses. Production bootstrap separately fails closed if the capability
  // contract is unavailable or malformed.
  const capabilitySides = globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__?.supportedAgentSides;
  const supportedArtifactSides = Object.freeze(
    Array.isArray(capabilitySides) && capabilitySides.length
      ? capabilitySides
          .map(side => String(side || "").toUpperCase())
          .filter((side, index, list) => /^[A-Z]$/.test(side) && list.indexOf(side) === index)
      : ["A", "B", "C"]
  );

  const serializedTypes = new Set([
    "AI_BRIDGE_START",
    "AI_BRIDGE_PAUSE",
    "AI_BRIDGE_RESUME",
    "AI_BRIDGE_STOP",
    "AI_BRIDGE_RESEND",
    "AI_BRIDGE_FORCE_RELAY",
    "AI_BRIDGE_INTERJECT",
    "AI_BRIDGE_SET_TEAM_RULES",
    "AI_BRIDGE_SET_AGENT_COUNT",
    "AI_BRIDGE_NEW_CHATS",
    "AI_BRIDGE_CLEAR_ARTIFACTS",
    "AI_BRIDGE_CLOUD_PULL",
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
  const originalTabReplacedAddListener = chrome.tabs?.onReplaced?.addListener
    ? chrome.tabs.onReplaced.addListener.bind(chrome.tabs.onReplaced)
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
      for (const side of supportedArtifactSides) {
        if (Number(state?.[`tab${side}`]) === tabId) return side;
      }
    } catch (_) {}
    return null;
  }

  function validateArtifactFetchRequest(message, sender) {
    if (message?.type !== "AI_BRIDGE_FETCH_ARTIFACT") return { ok: true };
    if (message.observed !== true) return { ok: false, error: "Artifact fallback requires a DOM-observed candidate." };

    const side = boundSideForSender(sender);
    if (!side) return { ok: false, error: "Artifact fallback sender is not a bound AI tab." };

    const generationId = String(message.generationId || "");
    const generationMatch = generationId.match(/^([A-Z])-\d{6,}-[a-z0-9_-]{4,80}$/i);
    const generationSide = String(generationMatch?.[1] || "").toUpperCase();
    if (
      !generationId ||
      generationId.length > 160 ||
      !generationMatch ||
      !supportedArtifactSides.includes(generationSide) ||
      generationSide !== side
    ) {
      return { ok: false, error: "Artifact fallback is missing a valid generation ID for the bound AI side." };
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

  if (originalTabReplacedAddListener) {
    chrome.tabs.onReplaced.addListener = function hardenedTabReplacedAddListener(listener) {
      if (typeof listener !== "function") return originalTabReplacedAddListener(listener);
      return originalTabReplacedAddListener((addedTabId, removedTabId) => {
        enqueueCoordinatorMutation(() => listener(addedTabId, removedTabId)).catch(error => {
          console.error("AI Bridge tab-replacement mutation failed", error);
        });
      });
    };
  }

  globalThis.enqueueCoordinatorMutation = enqueueCoordinatorMutation;

  globalThis.__AI_BRIDGE_COORDINATOR_MUTEX__ = Object.freeze({
    version: 6,
    enqueue: enqueueCoordinatorMutation,
    isSerializedType(type) { return serializedTypes.has(String(type || "")); },
    artifactProvenanceGate: true,
    artifactProvenanceSupportsDynamicSides: supportedArtifactSides.includes("D") && supportedArtifactSides.includes("E"),
    artifactProvenanceSides: supportedArtifactSides,
    serializesTabRemovalLifecycle: Boolean(originalTabRemovedAddListener),
    serializesTabReplacementLifecycle: Boolean(originalTabReplacedAddListener),
    serializesAgentCountMutation: serializedTypes.has("AI_BRIDGE_SET_AGENT_COUNT"),
    serializesIdleStateMutations:
      serializedTypes.has("AI_BRIDGE_NEW_CHATS") &&
      serializedTypes.has("AI_BRIDGE_CLEAR_ARTIFACTS") &&
      serializedTypes.has("AI_BRIDGE_CLOUD_PULL"),
    get active() { return active; }
  });
})();
