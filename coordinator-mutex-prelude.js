(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_COORDINATOR_MUTEX_PRELUDE_V1__";
  if (globalThis[FLAG]) return;
  globalThis[FLAG] = true;

  const serializedTypes = new Set([
    "AI_BRIDGE_START",
    "AI_BRIDGE_PAUSE",
    "AI_BRIDGE_RESUME",
    "AI_BRIDGE_STOP",
    "AI_BRIDGE_RESEND",
    "AI_BRIDGE_INTERJECT",
    "AI_BRIDGE_HUMAN_REOPEN",
    "AI_BRIDGE_HUMAN_SUPPRESS",
    "AI_BRIDGE_HUMAN_REPLY",
    "AI_BRIDGE_RESPONSE"
  ]);

  let queue = Promise.resolve();
  let active = 0;
  const originalAddListener = chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage);

  function runSerialized(listener, message, sender, sendResponse) {
    queue = queue.catch(() => {}).then(() => new Promise(resolve => {
      active += 1;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        active = Math.max(0, active - 1);
        resolve();
      };
      const wrappedSendResponse = value => {
        try { sendResponse(value); } finally { release(); }
      };
      try {
        const result = listener(message, sender, wrappedSendResponse);
        if (result !== true) release();
      } catch (error) {
        release();
        throw error;
      }
    }));
  }

  chrome.runtime.onMessage.addListener = function hardenedAddListener(listener) {
    if (typeof listener !== "function") return originalAddListener(listener);
    return originalAddListener((message, sender, sendResponse) => {
      if (!serializedTypes.has(String(message?.type || ""))) {
        return listener(message, sender, sendResponse);
      }
      runSerialized(listener, message, sender, sendResponse);
      return true;
    });
  };

  globalThis.__AI_BRIDGE_COORDINATOR_MUTEX__ = Object.freeze({
    version: 1,
    isSerializedType(type) { return serializedTypes.has(String(type || "")); },
    get active() { return active; }
  });
})();
