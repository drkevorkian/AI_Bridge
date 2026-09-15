// AI Bridge reconnect hardening.
//
// background.js owns the coordination engine. This module replaces only the
// page-listener recovery helper after background.js has loaded so reconnects
// rebuild the same content runtime declared by manifest.json.
(() => {
  "use strict";

  const EXPECTED_CONTENT_VERSION = typeof CONTENT_VERSION !== "undefined"
    ? CONTENT_VERSION
    : "1.14.0";
  const PING_ATTEMPTS = 8;
  const PING_DELAY_MS = 250;
  const RELOAD_TIMEOUT_MS = 20000;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isSupportedAiUrl(rawUrl) {
    const url = String(rawUrl || "");
    return [
      /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//,
      /^https:\/\/grok\.com\//,
      /^https:\/\/claude\.ai\//,
      /^https:\/\/gemini\.google\.com\//,
      /^https:\/\/copilot\.microsoft\.com\//
    ].some(pattern => pattern.test(url));
  }

  async function ping(tabId) {
    try {
      const pong = await chrome.tabs.sendMessage(tabId, { type: "AI_BRIDGE_PING" });
      if (pong?.ok && pong.version === EXPECTED_CONTENT_VERSION) return pong;
      return pong || null;
    } catch (_) {
      return null;
    }
  }

  async function waitForReadyTab(tabId) {
    const started = Date.now();
    while (Date.now() - started < RELOAD_TIMEOUT_MS) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.status === "complete" && tab?.url) return tab;
      } catch (_) {}
      await sleep(250);
    }
    throw new Error("Timed out waiting for the AI page to finish reloading.");
  }

  async function clearStaleContentBootstrapGuards(tabId) {
    // A failed ping means the existing page runtime is unusable. Stale
    // sentinels can otherwise make reinjection return immediately, leaving the
    // page without a working listener or without one of the safety wrappers.
    // Clear only AI Bridge-owned markers in the isolated content-script world.
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        try {
          delete window.__AI_BRIDGE_LOADED_V114__;
          delete window.__AI_BRIDGE_COMPLETION_GUARD_V1163__;
          delete window.__AI_BRIDGE_RESPONSE_DELIVERY_HARDENING_V1163__;
          delete window.__AI_BRIDGE_RESPONSE_DELIVERY_STATUS__;
        } catch (_) {
          window.__AI_BRIDGE_LOADED_V114__ = false;
          window.__AI_BRIDGE_COMPLETION_GUARD_V1163__ = false;
          window.__AI_BRIDGE_RESPONSE_DELIVERY_HARDENING_V1163__ = false;
          window.__AI_BRIDGE_RESPONSE_DELIVERY_STATUS__ = undefined;
        }
      }
    });
  }

  async function injectCompleteContentRuntime(tabId) {
    await clearStaleContentBootstrapGuards(tabId);
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        "content-completion-guard.js",
        "content-response-delivery-hardening.js",
        "content.js"
      ]
    });
  }

  async function hardenedEnsureTabListener(rawTabId) {
    if (!Number.isInteger(Number(rawTabId))) {
      throw new Error("No tab is assigned to this AI.");
    }
    const tabId = Number(rawTabId);

    const existingPong = await ping(tabId);
    if (existingPong?.ok && existingPong.version === EXPECTED_CONTENT_VERSION) {
      return existingPong;
    }

    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (err) {
      throw new Error(`The assigned AI tab is no longer available (${err?.message || "tab lookup failed"}).`);
    }

    if (!isSupportedAiUrl(tab?.url)) {
      throw new Error(`Selected tab is not on a supported AI site: ${tab?.url || "unknown URL"}`);
    }

    // If a live listener reports an older content runtime, reload the page so
    // Chrome discards that isolated world before rebuilding it from this
    // extension version.
    if (existingPong?.ok && existingPong.version !== EXPECTED_CONTENT_VERSION) {
      await chrome.tabs.reload(tabId);
      tab = await waitForReadyTab(tabId);
      if (!isSupportedAiUrl(tab?.url)) {
        throw new Error(`Selected tab changed to an unsupported URL while reconnecting: ${tab?.url || "unknown URL"}`);
      }
    }

    try {
      await injectCompleteContentRuntime(tabId);
    } catch (err) {
      throw new Error(`Could not reconnect to the AI page (${err?.message || "script injection failed"}). Refresh that tab and rebind it.`);
    }

    // executeScript resolves when execution completes, but provider pages and
    // extension reloads can still race message-port establishment. Probe for a
    // bounded two-second window instead of relying on one 150 ms attempt.
    for (let attempt = 0; attempt < PING_ATTEMPTS; attempt += 1) {
      const pong = await ping(tabId);
      if (pong?.ok && pong.version === EXPECTED_CONTENT_VERSION) return pong;
      if (attempt + 1 < PING_ATTEMPTS) await sleep(PING_DELAY_MS);
    }

    throw new Error("The page listener could not be established after complete runtime reinjection.");
  }

  globalThis.ensureTabListener = hardenedEnsureTabListener;
})();
