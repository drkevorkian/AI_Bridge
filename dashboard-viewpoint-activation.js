(() => {
  "use strict";

  const current = window.__AI_BRIDGE_DYNAMIC_DASHBOARD_V1__;
  if (!current || current.version !== 1) {
    throw new Error("Viewpoint dashboard activation requires the dynamic dashboard adapter.");
  }
  if (current.threadBadges !== true || current.duplicateThreadStartBlock !== true) {
    throw new Error("Viewpoint dashboard activation requires thread conflict safeguards.");
  }

  window.__AI_BRIDGE_DYNAMIC_DASHBOARD_V1__ = Object.freeze({
    ...current,
    duplicateProviderAgentsEnabled: true,
    viewpointModeEnabled: true,
    queueObservability: true
  });

  if (!document.querySelector("script[data-ai-bridge-viewpoint-queue]")) {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("dashboard-viewpoint-queue.js");
    script.async = false;
    script.dataset.aiBridgeViewpointQueue = "true";
    document.body.appendChild(script);
  }
})();
