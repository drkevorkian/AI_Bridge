(() => {
  "use strict";

  const RUNTIME_VERSION = "1.16.4";
  const FLAG = "__AI_BRIDGE_CONTENT_RUNTIME_PRELUDE__";
  if (window[FLAG]?.version === RUNTIME_VERSION) return;

  // If an older in-page runtime was reinjected, stop its polling loop before
  // the new content.js creates another one. A normal page reload starts with no
  // handle, so this is a no-op in the common case.
  try {
    if (window.__AI_BRIDGE_MONITOR_TIMER__) {
      clearInterval(window.__AI_BRIDGE_MONITOR_TIMER__);
      window.__AI_BRIDGE_MONITOR_TIMER__ = null;
    }
  } catch (_) {}

  const nativeSetInterval = window.setInterval.bind(window);
  let monitorCaptured = false;
  window.setInterval = function hardenedSetInterval(callback, delay, ...args) {
    const handle = nativeSetInterval(callback, delay, ...args);
    if (!monitorCaptured && Number(delay) === 650 && typeof callback === "function" && callback.name === "monitor") {
      monitorCaptured = true;
      try {
        if (window.__AI_BRIDGE_MONITOR_TIMER__ && window.__AI_BRIDGE_MONITOR_TIMER__ !== handle) {
          clearInterval(window.__AI_BRIDGE_MONITOR_TIMER__);
        }
      } catch (_) {}
      window.__AI_BRIDGE_MONITOR_TIMER__ = handle;
      // Restore the native API immediately; only AI Bridge's monitor interval
      // needs ownership tracking.
      window.setInterval = nativeSetInterval;
    }
    return handle;
  };

  // Content-side idempotency protects provider DOM from a duplicated
  // chrome.tabs.sendMessage delivery. Only a successful AI_BRIDGE_SEND is
  // remembered; failed sends may legitimately be retried with the same
  // generation id. Keep a bounded cache because a provider tab can stay open
  // for days during a long relay session.
  const acceptedSends = new Map();
  const MAX_ACCEPTED_SENDS = 64;
  function rememberAcceptedSend(generationId, text) {
    const id = String(generationId || "");
    if (!id) return;
    acceptedSends.set(id, String(text || ""));
    while (acceptedSends.size > MAX_ACCEPTED_SENDS) {
      acceptedSends.delete(acceptedSends.keys().next().value);
    }
  }

  function normalizedComparableText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\r/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // Exact prompt echoes are never valid assistant completions. Broad provider
  // selectors can momentarily surface the just-submitted user prompt on SPAs;
  // short-circuit only exact same-generation echoes so real repeated answers
  // remain valid. Return an intentional terminal ignore that the delivery layer
  // already understands, avoiding retry churn while the real response renders.
  const nativeSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = function hardenedRuntimeSendMessage(message, ...args) {
    if (message?.type === "AI_BRIDGE_RESPONSE") {
      const id = String(message.generationId || "");
      const sent = acceptedSends.get(id);
      if (id && sent !== undefined && normalizedComparableText(message.text) === normalizedComparableText(sent)) {
        return Promise.resolve({ ok: false, ignored: true, promptEcho: true });
      }
    }
    return nativeSendMessage(message, ...args);
  };

  // content.js historically replies with its source-era version string. Rewrite
  // only AI_BRIDGE_PING responses so the service worker can verify the actual
  // injected runtime stack rather than one legacy file's internal label. The
  // same wrapper also makes AI_BRIDGE_SEND idempotent per generation id.
  const nativeAddListener = chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage);
  chrome.runtime.onMessage.addListener = function versionedAddListener(listener) {
    if (typeof listener !== "function") return nativeAddListener(listener);
    return nativeAddListener((message, sender, sendResponse) => {
      if (message?.type === "AI_BRIDGE_PING") {
        const versionedResponse = value => {
          if (value && typeof value === "object") {
            sendResponse({ ...value, version: RUNTIME_VERSION, runtimeVersion: RUNTIME_VERSION });
          } else {
            sendResponse(value);
          }
        };
        return listener(message, sender, versionedResponse);
      }

      if (message?.type === "AI_BRIDGE_SEND") {
        const generationId = String(message.generationId || "");
        if (generationId && acceptedSends.has(generationId)) {
          sendResponse({ ok: true, duplicateSend: true, generationId, uploadedCount: Array.isArray(message.artifacts) ? message.artifacts.length : 0 });
          return false;
        }
        const trackedResponse = value => {
          if (value?.ok === true && generationId) rememberAcceptedSend(generationId, message.text);
          sendResponse(value);
        };
        return listener(message, sender, trackedResponse);
      }

      return listener(message, sender, sendResponse);
    });
  };

  window[FLAG] = Object.freeze({
    version: RUNTIME_VERSION,
    monitorTimerOwned: true,
    sendIdempotency: true,
    promptEchoFilter: true
  });
})();
