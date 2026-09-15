(() => {
  "use strict";

  // Keep the computer awake only while AI Bridge is actively running.
  // `system` prevents inactivity sleep without unnecessarily forcing the
  // monitor to stay lit; Pause/Stop releases the request through the persisted
  // bridgeState transition.
  const BRIDGE_STATE_KEY = "bridgeState";
  let keepAwakeRequested = false;

  function shouldKeepSystemAwake(bridgeState) {
    return Boolean(bridgeState?.sessionActive && bridgeState?.running);
  }

  function applyPowerState(bridgeState) {
    const shouldStayAwake = shouldKeepSystemAwake(bridgeState);
    if (shouldStayAwake === keepAwakeRequested) return;

    try {
      if (shouldStayAwake) {
        chrome.power.requestKeepAwake("system");
        keepAwakeRequested = true;
      } else {
        chrome.power.releaseKeepAwake();
        keepAwakeRequested = false;
      }
    } catch (err) {
      // Power management failure must never break the Bridge session itself.
      // Log it so Diagnostics can surface the failure later.
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

  // Manifest V3 service workers are disposable. Reconstruct the power request
  // whenever Chrome starts this worker again so an active long-running Bridge
  // session does not become sleep-prone after worker suspension/restart.
  syncPowerStateFromStorage();
})();
