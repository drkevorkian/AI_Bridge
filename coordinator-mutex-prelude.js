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
   * Run one coordinator state mutation on the same FIFO promise chain used by
   * control-plane messages.  This is intentionally exported so non-message
   * event sources (notably chrome.alarms watchdog ticks) cannot mutate bridge
   * state concurrently with START/STOP/RESEND/RESPONSE handling.
   *
   * Callers should keep slow read-only provider probes outside this queue and
   * revalidate their snapshot inside the task before committing state.
   */
  function enqueueCoordinatorMutation(task) {
    if (typeof task !== "function") {
      return Promise.reject(new TypeError("Coordinator mutation task must be a function."));
    }

    const run = queue.catch(() => {}).then(async () => {
      active += 1;
      try {
        return await task();
      } finally {
        active = Math.max(0, active - 1);
      }
    });

    // Keep the internal chain usable even when an individual caller fails;
    // return the original promise so that caller still observes its exception.
    queue = run.then(() => undefined, () => undefined);
    return run;
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
        const result = listener(message, sender, wrappedSendResponse);
        if (result !== true) release();
      } catch (error) {
        released = true;
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
      runSerialized(listener, message, sender, sendResponse).catch(error => {
        console.error("AI Bridge serialized coordinator listener failed", error);
        try { sendResponse({ ok: false, error: error?.message || String(error) }); } catch (_) {}
      });
      return true;
    });
  };

  globalThis.enqueueCoordinatorMutation = enqueueCoordinatorMutation;
  globalThis.__AI_BRIDGE_COORDINATOR_MUTEX__ = Object.freeze({
    version: 2,
    isSerializedType(type) { return serializedTypes.has(String(type || "")); },
    enqueue: enqueueCoordinatorMutation,
    get active() { return active; }
  });
})();
