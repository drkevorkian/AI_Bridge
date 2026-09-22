(() => {
  "use strict";

  // Keep the computer awake only while AI Bridge is actively running.
  // `system` prevents inactivity sleep without forcing the monitor to stay
  // lit. Pause, Stop, and HUMAN_INPUT release the request via persisted
  // bridgeState. Manifest V3 service workers are disposable: Chrome may drop
  // a keep-awake when the worker is killed, so this module re-asserts on
  // every worker start, storage change, alarm, and browser startup.
  const BRIDGE_STATE_KEY = "bridgeState";
  let keepAwakeRequested = false;

  function shouldKeepSystemAwake(bridgeState) {
    return Boolean(
      bridgeState?.sessionActive &&
      bridgeState?.running &&
      !bridgeState?.awaitingHuman
    );
  }

  function applyPowerState(bridgeState) {
    if (!chrome.power?.requestKeepAwake || !chrome.power?.releaseKeepAwake) return;
    const shouldStayAwake = shouldKeepSystemAwake(bridgeState);
    try {
      if (shouldStayAwake) {
        // Idempotent. Always re-request so a silent drop after service-worker
        // eviction cannot leave a live session sleep-prone.
        chrome.power.requestKeepAwake("system");
        keepAwakeRequested = true;
        return;
      }
      chrome.power.releaseKeepAwake();
      keepAwakeRequested = false;
    } catch (err) {
      // Power management failure must never break the Bridge session itself.
      console.warn("AI Bridge could not update system-awake state", err);
    }
  }

  async function syncPowerStateFromStorage() {
    try {
      const stored = await chrome.storage.local.get(BRIDGE_STATE_KEY);
      applyPowerState(stored?.[BRIDGE_STATE_KEY]);
    } catch (err) {
      console.warn("AI Bridge could not restore system-awake state", err);
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes?.[BRIDGE_STATE_KEY]) return;
    applyPowerState(changes[BRIDGE_STATE_KEY].newValue);
  });

  if (chrome.alarms?.onAlarm) {
    chrome.alarms.onAlarm.addListener(() => {
      syncPowerStateFromStorage();
    });
  }

  if (chrome.runtime?.onStartup) {
    chrome.runtime.onStartup.addListener(() => {
      syncPowerStateFromStorage();
    });
  }

  syncPowerStateFromStorage();
})();
