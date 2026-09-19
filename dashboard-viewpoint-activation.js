(() => {
  "use strict";

  const API_KEY = "__AI_BRIDGE_DYNAMIC_DASHBOARD_V1__";
  let activated = false;

  function loadViewpointAdapters() {
    if (!document.querySelector("script[data-ai-bridge-viewpoint-queue]")) {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("dashboard-viewpoint-queue.js");
      script.async = false;
      script.dataset.aiBridgeViewpointQueue = "true";
      document.body.appendChild(script);
    }

    if (!document.querySelector("script[data-ai-bridge-viewpoint-badges]")) {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("dashboard-viewpoint-badges.js");
      script.async = false;
      script.dataset.aiBridgeViewpointBadges = "true";
      document.body.appendChild(script);
    }
  }

  function activate(current) {
    if (activated) return;
    if (!current || current.version !== 1) {
      throw new Error("Viewpoint dashboard activation requires the dynamic dashboard adapter.");
    }
    if (current.threadBadges !== true || current.duplicateThreadStartBlock !== true) {
      throw new Error("Viewpoint dashboard activation requires thread conflict safeguards.");
    }

    activated = true;
    const activatedApi = Object.freeze({
      ...current,
      duplicateProviderAgentsEnabled: true,
      viewpointModeEnabled: true,
      queueObservability: true,
      sanitizedViewpointBadges: true,
      activationWaitsForDynamicDashboard: true
    });

    // Replace any temporary readiness accessor with the normal data property
    // before loading dependent scripts. This avoids recursive setter calls and
    // ensures every later consumer sees the fully activated immutable API.
    Object.defineProperty(window, API_KEY, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: activatedApi
    });

    loadViewpointAdapters();
  }

  const current = window[API_KEY];
  if (current) {
    activate(current);
    return;
  }

  // dashboard-dynamic-agents.js publishes its API only after asynchronous state,
  // tab, and Provider Health initialization. A script load event proves only that
  // its source finished evaluating, not that those awaited operations completed.
  // Install a temporary property accessor so the eventual API assignment itself
  // becomes the readiness signal. No polling, timer, or untrusted event payload is
  // involved, and dependent viewpoint scripts cannot start against a partial API.
  const descriptor = Object.getOwnPropertyDescriptor(window, API_KEY);
  if (descriptor && descriptor.configurable === false) {
    throw new Error("Viewpoint dashboard activation cannot wait for a non-configurable dynamic dashboard API.");
  }

  let pendingValue;
  Object.defineProperty(window, API_KEY, {
    configurable: true,
    enumerable: true,
    get() {
      return pendingValue;
    },
    set(value) {
      pendingValue = value;
      activate(value);
    }
  });
})();
