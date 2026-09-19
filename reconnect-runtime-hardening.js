// AI Bridge reconnect hardening.
//
// A content-script isolated world can retain patched APIs and timers after an
// extension/service-worker restart. Recovery therefore reloads the provider tab
// and lets manifest-declared content scripts build one clean runtime instead of
// stacking another set of wrappers into the live world.
(() => {
  "use strict";

  const EXPECTED_CONTENT_VERSION = "1.18.0";
  const PING_ATTEMPTS = 12;
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
      await sleep(PING_DELAY_MS);
    }
    throw new Error("Timed out waiting for the AI page to finish reloading.");
  }

  async function pingUntilCurrent(tabId) {
    for (let attempt = 0; attempt < PING_ATTEMPTS; attempt += 1) {
      const pong = await ping(tabId);
      if (pong?.ok && pong.version === EXPECTED_CONTENT_VERSION) return pong;
      if (attempt + 1 < PING_ATTEMPTS) await sleep(PING_DELAY_MS);
    }
    return null;
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

    // Any missing/mismatched listener is recovered through a full page reload.
    // This destroys the old isolated world, response wrappers, completion guard,
    // and monitor interval before Chrome injects the manifest stack again.
    try {
      await chrome.tabs.reload(tabId);
      tab = await waitForReadyTab(tabId);
    } catch (err) {
      throw new Error(`Could not reload the AI page for reconnect (${err?.message || "reload failed"}).`);
    }
    if (!isSupportedAiUrl(tab?.url)) {
      throw new Error(`Selected tab changed to an unsupported URL while reconnecting: ${tab?.url || "unknown URL"}`);
    }

    const pong = await pingUntilCurrent(tabId);
    if (pong) return pong;

    // Do not inject over a live/partially initialized isolated world. A second
    // reload is safer than double-wrapping chrome.runtime.sendMessage or
    // stacking content.js polling timers.
    try {
      await chrome.tabs.reload(tabId);
      tab = await waitForReadyTab(tabId);
    } catch (err) {
      throw new Error(`Could not complete clean reconnect (${err?.message || "reload failed"}).`);
    }
    if (!isSupportedAiUrl(tab?.url)) {
      throw new Error(`Selected tab changed to an unsupported URL while reconnecting: ${tab?.url || "unknown URL"}`);
    }

    const retryPong = await pingUntilCurrent(tabId);
    if (retryPong) return retryPong;
    throw new Error("The page listener could not be established after clean page reloads. Reload the extension, refresh that AI tab, and rebind it.");
  }

  globalThis.ensureTabListener = hardenedEnsureTabListener;
  globalThis.__AI_BRIDGE_RECONNECT_HARDENING__ = Object.freeze({
    version: 3,
    contentRuntimeVersion: EXPECTED_CONTENT_VERSION,
    recovery: "clean-reload"
  });
})();
