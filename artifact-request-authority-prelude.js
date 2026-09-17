(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_ARTIFACT_REQUEST_AUTHORITY_V1__";
  if (globalThis[FLAG]) return;

  const caps = globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__;
  if (!caps || caps.version !== 1 || typeof caps.conversationIdentity !== "function") {
    throw new Error("Artifact request authority requires the conversation-identity contract.");
  }

  function sameConversationIdentity(expected, observed) {
    if (!expected || !observed) return false;
    return String(expected.provenanceId || "") === String(observed.provenanceId || "") &&
      String(expected.threadKey || "") === String(observed.threadKey || "") &&
      String(expected.providerFamily || "") === String(observed.familyId || "") &&
      Number(expected.boundTabId) === Number(observed.tabId);
  }

  function authorizeArtifactRequest({ bridgeState, side, tabId, message }) {
    const normalizedSide = String(side || "").toUpperCase();
    const trustedTabId = Number(tabId);
    const msg = message && typeof message === "object" ? message : {};
    if (!normalizedSide || !Number.isInteger(trustedTabId) || trustedTabId <= 0) {
      throw new Error("Artifact fetch requires trusted bound-tab authority.");
    }

    const pageUrl = String(msg.pageUrl || "");
    const observed = caps.conversationIdentity({
      side: normalizedSide,
      tabId: trustedTabId,
      url: pageUrl
    });
    if (!observed) {
      throw new Error("Artifact fetch requires a trusted current provider conversation.");
    }

    // Manual Relay is deliberately allowed to capture a newly navigated thread.
    // The caller is still a bound session tab and pageUrl comes directly from the
    // extension content script's isolated world. Manual Relay validates/refreshes
    // the captured viewpoint before transcript commit.
    if (msg.manualCapture === true) {
      return Object.freeze({
        ok: true,
        mode: "manual-capture",
        side: normalizedSide,
        threadKey: String(observed.threadKey || "")
      });
    }

    const state = bridgeState && typeof bridgeState === "object" ? bridgeState : {};
    const expectedGeneration = String(state.generationIdBySide?.[normalizedSide] || "");
    const incomingGeneration = String(msg.generationId || "");
    if (!expectedGeneration || !incomingGeneration || expectedGeneration !== incomingGeneration) {
      throw new Error("Automatic artifact fetch requires the currently armed generation.");
    }

    const expectedIdentity = state.viewpointIdentityBySide?.[normalizedSide] || null;
    if (!sameConversationIdentity(expectedIdentity, observed)) {
      throw new Error("Automatic artifact fetch conversation no longer matches dispatch provenance.");
    }

    return Object.freeze({
      ok: true,
      mode: "automatic",
      side: normalizedSide,
      threadKey: String(observed.threadKey || "")
    });
  }

  globalThis.aiBridgeAuthorizeArtifactRequest = authorizeArtifactRequest;
  globalThis[FLAG] = Object.freeze({
    version: 1,
    automaticRequiresArmedGeneration: true,
    automaticRequiresDispatchConversation: true,
    manualCaptureAllowsProvenanceRefresh: true,
    pageIdentityRemainsWorkerPrivate: true
  });
})();
