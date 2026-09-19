(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_RESEND_HARDENING_V1__";
  if (globalThis[FLAG]) return;

  if (typeof sendToSide !== "function" || typeof tabForSide !== "function" || typeof ensureTabListener !== "function") {
    throw new Error("AI Bridge resend hardening could not attach to the coordinator runtime.");
  }

  const STATUS_TYPE = "AI_BRIDGE_GENERATION_STATUS";
  const STOP_TYPE = "AI_BRIDGE_STOP_GENERATION";
  const STOP_TIMEOUT_MS = 5000;
  const STOP_POLL_MS = 100;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function providerGenerationStatus(tabId) {
    const status = await chrome.tabs.sendMessage(Number(tabId), { type: STATUS_TYPE });
    if (!status || status.ok !== true) throw new Error("Provider generation status was unavailable.");
    return status;
  }

  async function stopActiveGeneration(side) {
    const tabId = Number(tabForSide(side));
    if (!Number.isInteger(tabId) || tabId <= 0) throw new Error(`No provider tab is assigned to AI ${side}.`);

    await ensureTabListener(tabId);
    let status = await providerGenerationStatus(tabId);
    if (!status.generating) return { stopped: false, tabId };

    const stop = await chrome.tabs.sendMessage(tabId, { type: STOP_TYPE });
    if (!stop?.ok) throw new Error(stop?.error || `Could not stop AI ${side}'s active generation.`);
    if (!stop.stopped && status.generating) {
      throw new Error(`AI ${side} is still generating but no usable Stop control was found.`);
    }

    const deadline = Date.now() + STOP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(STOP_POLL_MS);
      status = await providerGenerationStatus(tabId);
      if (!status.generating) return { stopped: true, tabId };
    }
    throw new Error(`AI ${side} did not stop its previous generation before the replacement send.`);
  }

  // Enforce the invariant globally: AI Bridge never submits a new prompt into a
  // provider tab while that tab reports an active generation. RESEND is the
  // main beneficiary, but applying the guard at sendToSide also protects resume,
  // recovery, and future call sites from accidental generation overlap.
  const baseSendToSide = sendToSide;
  sendToSide = async function overlapSafeSendToSide(side, text, options = {}) {
    await stopActiveGeneration(side);
    return baseSendToSide(side, text, options);
  };

  globalThis[FLAG] = Object.freeze({
    version: 1,
    stopBeforeReplacement: true,
    timeoutMs: STOP_TIMEOUT_MS
  });
})();
