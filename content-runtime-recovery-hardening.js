(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_CONTENT_RECOVERY_V1__";
  if (globalThis[FLAG]) return;

  const caps = globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__;
  if (!caps || caps.version !== 1 || typeof caps.providerFamilyForUrl !== "function") {
    throw new Error("Content runtime recovery requires the provider capability contract.");
  }
  if (typeof ensureTabListener !== "function") {
    throw new Error("Content runtime recovery requires the base tab-listener helper.");
  }

  const REQUIRED_STACK = Object.freeze([
    "content-runtime-prelude.js",
    "content-artifact-security-prelude.js",
    "content-completion-guard.js",
    "content-response-delivery-hardening.js",
    "content.js"
  ]);

  function manifest() {
    const value = chrome?.runtime?.getManifest?.();
    if (!value || typeof value !== "object") {
      throw new Error("AI Bridge could not read its extension manifest.");
    }
    return value;
  }

  function expectedRuntimeVersion() {
    const version = String(manifest().version || "").trim();
    if (!version) throw new Error("AI Bridge manifest does not declare a runtime version.");
    return version;
  }

  function recoveryScriptStack() {
    const registrations = Array.isArray(manifest().content_scripts) ? manifest().content_scripts : [];
    const registration = registrations.find(entry => Array.isArray(entry?.js) && entry.js.includes("content.js"));
    if (!registration) {
      throw new Error("AI Bridge manifest does not declare the provider content runtime stack.");
    }

    const files = registration.js.map(file => String(file || "")).filter(Boolean);
    let lastIndex = -1;
    for (const required of REQUIRED_STACK) {
      const index = files.indexOf(required);
      if (index < 0 || index <= lastIndex) {
        throw new Error(`AI Bridge provider content runtime is missing or misorders ${required}.`);
      }
      lastIndex = index;
    }
    if (files[files.length - 1] !== "content.js") {
      throw new Error("AI Bridge provider content runtime must load content.js after every hardening prelude.");
    }
    return files;
  }

  async function rawPing(tabId) {
    try {
      return await chrome.tabs.sendMessage(tabId, { type: "AI_BRIDGE_PING" });
    } catch (_) {
      return null;
    }
  }

  function pongRuntimeVersion(pong) {
    return String(pong?.runtimeVersion || pong?.version || "").trim();
  }

  function currentPong(pong) {
    return Boolean(pong?.ok === true && pongRuntimeVersion(pong) === expectedRuntimeVersion());
  }

  async function waitForExpectedPing(tabId, timeoutMs = 3000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const pong = await rawPing(tabId);
      if (currentPong(pong)) return pong;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const finalPong = await rawPing(tabId);
    return currentPong(finalPong) ? finalPong : null;
  }

  async function waitForTabComplete(tabId, timeoutMs = 20000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.status === "complete") return tab;
      } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error("Timed out waiting for the AI page to reload its content runtime.");
  }

  async function requireTrustedProviderTab(tabId) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (_) {
      throw new Error("The selected AI tab is no longer available.");
    }
    if (!caps.providerFamilyForUrl(tab?.url || "")) {
      throw new Error(`Selected tab is not on a supported AI site: ${tab?.url || "unknown URL"}`);
    }
    return tab;
  }

  ensureTabListener = async function hardenedEnsureTabListener(rawTabId) {
    const tabId = Number(rawTabId);
    if (!Number.isInteger(tabId) || tabId <= 0) throw new Error("No tab is assigned to this AI.");

    const existingPong = await rawPing(tabId);
    if (currentPong(existingPong)) return existingPong;

    // A responding but mismatched runtime is stale. Reload once so Chrome can
    // install the current manifest-declared stack naturally at document_idle.
    if (existingPong?.ok === true) {
      await requireTrustedProviderTab(tabId);
      await chrome.tabs.reload(tabId);
      await waitForTabComplete(tabId);
      const reloadedPong = await waitForExpectedPing(tabId);
      if (reloadedPong) return reloadedPong;
    }

    // Tabs that were already open when the extension was installed may not have
    // any Bridge listener yet. Recover by injecting the complete manifest stack
    // in manifest order. Never inject bare content.js because that would skip
    // idempotency, artifact-credential, completion, and delivery hardening.
    await requireTrustedProviderTab(tabId);
    const files = recoveryScriptStack();
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files });
    } catch (err) {
      throw new Error(`Could not connect to the page (${err?.message || err}). Try refreshing that AI tab once.`);
    }

    const recoveredPong = await waitForExpectedPing(tabId);
    if (recoveredPong) return recoveredPong;
    throw new Error("The full AI Bridge content runtime could not be established after recovery injection.");
  };

  globalThis[FLAG] = Object.freeze({
    version: 1,
    expectedVersionFromManifest: true,
    injectsFullManifestStack: true,
    rejectsBareContentRecovery: true,
    requiredStack: REQUIRED_STACK
  });
})();
