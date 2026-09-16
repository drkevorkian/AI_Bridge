(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_COORDINATOR_MUTEX_PRELUDE_V2__";
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
    "AI_BRIDGE_HUMAN_REOPEN",
    "AI_BRIDGE_HUMAN_SUPPRESS",
    "AI_BRIDGE_HUMAN_REPLY",
    "AI_BRIDGE_RESPONSE"
  ]);

  let queue = Promise.resolve();
  let active = 0;
  const originalAddListener = chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage);

  /**
   * Serialize one coordinator state mutation on the same promise chain used by
   * message-driven control-plane actions. Callers should keep slow external
   * probes outside this critical section and revalidate coordinator state
   * inside the task immediately before committing mutations.
   */
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

    // Keep the internal queue alive after a failed task without hiding that
    // failure from the caller that owns `result`.
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
        try { sendResponse(value); } finally { release(); }
      };
      try {
        const listenerResult = listener(message, sender, wrappedSendResponse);
        if (listenerResult !== true) release();
      } catch (error) {
        reject(error);
      }
    }));
  }

  chrome.runtime.onMessage.addListener = function hardenedAddListener(listener) {
    if (typeof listener !== "function") return originalAddListener(listener);
    return originalAddListener((message, sender, sendResponse) => {
      if (!serializedTypes.has(String(message?.type || ""))) {
        return listener(message, sender, sendResponse);
      }
      // The listener owns response/error reporting. This catch prevents an
      // unhandled rejection if a synchronous listener failure escapes.
      runSerialized(listener, message, sender, sendResponse).catch(error => {
        console.error("AI Bridge coordinator mutation failed", error);
      });
      return true;
    });
  };

  // Alarm-driven watchdog recovery and future non-message mutation sources use
  // this exact queue. Do not create independent locks for coordinator state.
  globalThis.enqueueCoordinatorMutation = enqueueCoordinatorMutation;

  globalThis.__AI_BRIDGE_COORDINATOR_MUTEX__ = Object.freeze({
    version: 2,
    enqueue: enqueueCoordinatorMutation,
    isSerializedType(type) { return serializedTypes.has(String(type || "")); },
    get active() { return active; }
  });
})();
