(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_MANUAL_RELAY_HARDENING_V1__";
  if (globalThis[FLAG]) return;

  if (typeof captureLatestFromSide !== "function" || typeof forceRelayCapturedResponse !== "function") {
    throw new Error("AI Bridge manual-relay hardening loaded before coordinator capture support.");
  }

  const caps = globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__;
  if (!caps || caps.version !== 1 || typeof caps.conversationIdentity !== "function") {
    throw new Error("AI Bridge manual-relay hardening requires the conversation-identity contract.");
  }

  const baseForceRelayCapturedResponse = forceRelayCapturedResponse;
  const manualIdentityBySide = new Map();

  /**
   * Capture the latest provider reply while preserving the content runtime's
   * generation identity. The coordinator's legacy helper discarded this field,
   * which made two legitimate same-text responses indistinguishable.
   */
  async function hardenedCaptureLatestFromSide(side) {
    const normalized = String(side || "").toUpperCase();
    const tabId = tabForSide(normalized);
    if (!Number.isInteger(Number(tabId))) throw new Error(`Bind a tab for AI ${normalized} first.`);
    await ensureTabListener(tabId);

    let result;
    try {
      result = await chrome.tabs.sendMessage(Number(tabId), { type: "AI_BRIDGE_CAPTURE_LATEST" });
    } catch (_) {
      await ensureTabListener(tabId);
      result = await chrome.tabs.sendMessage(Number(tabId), { type: "AI_BRIDGE_CAPTURE_LATEST" });
    }
    if (!result?.ok) throw new Error(result?.error || `Could not read AI ${normalized}'s latest on-page reply.`);

    const text = String(result.text || "").trim();
    if (!text) throw new Error(`AI ${normalized}'s tab has no visible assistant reply to capture.`);
    if (text.length > MAX_FORCE_RELAY_CHARS) {
      throw new Error(`Captured reply from AI ${normalized} exceeds the ${MAX_FORCE_RELAY_CHARS} character relay limit.`);
    }
    if (result.generating) {
      throw new Error(`AI ${normalized} is still generating. Wait for the reply to finish before using Manual Relay.`);
    }

    const generationId = String(result.generationId || "");
    const pageUrl = String(result.pageUrl || "");
    return {
      text,
      artifacts: Array.isArray(result.artifacts) ? result.artifacts : [],
      artifactDiagnostics: result.artifactDiagnostics || null,
      completedAt: Number(result.completedAt) || Date.now(),
      generationId,
      pageUrl,
      generating: false
    };
  }

  captureLatestFromSide = hardenedCaptureLatestFromSide;

  function refreshManualRelayViewpointIdentity(side, pageUrl) {
    const normalized = String(side || "").toUpperCase();
    const tabId = Number(tabForSide(normalized));
    if (!Number.isInteger(tabId) || tabId <= 0) {
      throw new Error(`Bind a tab for AI ${normalized} first.`);
    }
    const observedUrl = String(pageUrl || "");
    if (!observedUrl) {
      throw new Error(`AI ${normalized} capture did not include page identity. Refresh that AI tab once before using Manual Relay.`);
    }

    // The URL is added inside the extension's isolated content-script world to
    // the exact AI_BRIDGE_CAPTURE_LATEST reply. Derive provenance from that
    // captured page rather than a stale prior dispatch or a later tab lookup.
    const identity = caps.conversationIdentity({ side: normalized, tabId, url: observedUrl });
    if (!identity) {
      throw new Error(`AI ${normalized} capture did not come from a trusted provider conversation.`);
    }
    if (Number(identity.tabId) !== tabId) {
      throw new Error(`AI ${normalized} capture no longer matches its bound browser tab.`);
    }

    const safe = {
      provenanceId: String(identity.provenanceId || ""),
      threadKey: String(identity.threadKey || ""),
      providerFamily: String(identity.familyId || ""),
      boundTabId: tabId
    };
    if (!safe.provenanceId || !safe.threadKey || !safe.providerFamily) {
      throw new Error(`AI ${normalized} capture did not produce complete conversation provenance.`);
    }

    state.viewpointIdentityBySide = {
      ...(state.viewpointIdentityBySide && typeof state.viewpointIdentityBySide === "object" ? state.viewpointIdentityBySide : {}),
      [normalized]: safe
    };
    return safe;
  }

  function validateManualTargets(fromSide, targets) {
    const dest = sanitizeForceRelaySides(targets);
    if (!dest.length) throw new Error("Choose at least one destination AI.");

    if (isSequentialWorkMode?.(state.workMode)) {
      if (dest.length > 1) {
        throw new Error("Relay, Collaborate, and Direct Mesh have one coordinator cursor. Choose one Manual Relay destination so later replies cannot be silently discarded.");
      }

      // In sequential modes the coordinator accepts the next normal response
      // only from state.currentSide. The legacy manual-relay helper advances
      // that cursor when the captured source itself is current. If the source
      // is not current, only relaying back to the existing cursor is safe;
      // silently moving the cursor here could orphan an AI that is already
      // generating its assigned turn.
      const current = String(state.currentSide || "").toUpperCase();
      if (SIDES.includes(current) && fromSide !== current && dest[0] !== current) {
        throw new Error(`Sequential Manual Relay would abandon the coordinator cursor at AI ${current}. Relay to AI ${current}, or capture from AI ${current} before routing to another AI.`);
      }
    }

    if (isBatchWorkMode?.(state.workMode)) {
      const pending = new Set(Array.isArray(state.phasePendingSides) ? state.phasePendingSides : []);
      const unsafe = dest.filter(side => !pending.has(side));
      if (unsafe.length) {
        throw new Error(`Batch Manual Relay can target only currently pending AIs. Not pending: ${unsafe.map(side => `AI ${side}`).join(", ")}.`);
      }
    }
    return dest;
  }

  forceRelayCapturedResponse = async function hardenedForceRelayCapturedResponse(source, targets) {
    const fromSide = String(source || "").toUpperCase();
    const dest = validateManualTargets(fromSide, targets);
    const captured = await hardenedCaptureLatestFromSide(fromSide);

    // Manual Relay is allowed to capture a reply that was not dispatched by the
    // coordinator. Refresh the side's viewpoint identity from the exact page URL
    // returned with this capture before the legacy helper records the transcript.
    // Otherwise a tab navigated from /c/old to /c/new would stamp /c/new output
    // with the previous dispatch's /c/old provenance.
    const refreshedViewpoint = refreshManualRelayViewpointIdentity(fromSide, captured.pageUrl);

    // The legacy implementation calls captureLatestFromSide internally. Reuse
    // this exact snapshot so DOM changes between two reads cannot make the
    // transcript entry differ from what is actually relayed.
    const liveCapture = captureLatestFromSide;
    captureLatestFromSide = async side => {
      if (String(side || "").toUpperCase() !== fromSide) return liveCapture(side);
      return captured;
    };

    const priorText = state.lastResponseBySide?.[fromSide];
    const previousIdentity = manualIdentityBySide.get(fromSide) || "";
    const identity = captured.generationId || `${captured.completedAt}:${captured.text.length}:${captured.artifacts.length}`;
    const sameTextNewIdentity = Boolean(previousIdentity && identity !== previousIdentity && priorText === captured.text);
    const sentinel = `__AI_BRIDGE_MANUAL_IDENTITY_${Date.now()}_${Math.random().toString(36).slice(2)}__`;

    // Only defeat the legacy text-only duplicate check when we have positive
    // evidence that this is a different provider generation. Never turn an
    // ordinary re-send of the same generation into a second transcript turn.
    if (sameTextNewIdentity) state.lastResponseBySide[fromSide] = sentinel;

    try {
      const result = await baseForceRelayCapturedResponse(fromSide, dest);
      manualIdentityBySide.set(fromSide, identity);
      return {
        ...result,
        responseIdentity: identity,
        sameTextNewGeneration: sameTextNewIdentity,
        safeFanout: true,
        refreshedViewpointProvenance: true,
        viewpointProviderFamily: refreshedViewpoint.providerFamily
      };
    } finally {
      captureLatestFromSide = liveCapture;
      // If the legacy function failed before replacing the sentinel with the
      // captured text, restore the coordinator's prior duplicate state.
      if (state.lastResponseBySide?.[fromSide] === sentinel) {
        state.lastResponseBySide[fromSide] = priorText;
      }
    }
  };

  globalThis[FLAG] = Object.freeze({
    version: 3,
    rejectsStreamingCapture: true,
    generationAwareIdentity: true,
    sequentialFanoutSafe: true,
    sequentialCursorGate: true,
    batchPendingTargetGate: true,
    refreshesViewpointProvenanceFromCapturedUrl: true,
    requiresCapturePageUrl: true
  });
})();
