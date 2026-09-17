(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_GENERATION_HARDENING_V1__";
  if (globalThis[FLAG]) return;
  globalThis[FLAG] = true;

  // Responses are valid only when both sides present the same non-empty
  // generation ID. During START/RESUME setup the coordinator therefore cannot
  // accidentally accept leftover DOM output from a previous generation.
  generationMatches = function hardenedGenerationMatches(expectedId, incomingId) {
    const expected = String(expectedId || "");
    const incoming = String(incomingId || "");
    return Boolean(expected && incoming && incoming === expected);
  };

  const persistenceAvailable = typeof saveState === "function";
  const caps = globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__ || null;
  let generationPersistenceQueue = Promise.resolve();

  // Generation authorization changes cross the MV3 persistence boundary in both
  // directions: a token must be durable before its prompt reaches a provider,
  // and a consumed/failed token must be durably cleared before execution moves
  // on. Serialize these security-critical writes so concurrent batch sends cannot
  // reorder generation snapshots relative to one another.
  async function persistGenerationState() {
    if (!persistenceAvailable) {
      throw new Error("Generation persistence is unavailable.");
    }
    const task = async () => saveState();
    const next = generationPersistenceQueue.catch(() => undefined).then(task);
    generationPersistenceQueue = next;
    return next;
  }

  let armingHelperAttached = false;
  if (persistenceAvailable) {
    globalThis.persistArmedGenerationBeforeProviderSend = async function persistArmedGenerationBeforeProviderSend(side, generationId) {
      const normalizedSide = String(side || "").toUpperCase();
      const incomingGenerationId = String(generationId || "");
      const expectedGenerationId = String(state?.generationIdBySide?.[normalizedSide] || "");
      if (!generationMatches(expectedGenerationId, incomingGenerationId)) {
        throw new Error(`AI ${normalizedSide || "?"} generation changed before provider dispatch.`);
      }

      await persistGenerationState();

      // Re-check after the async storage boundary. If some lifecycle action
      // deliberately disarmed/replaced this side while persistence was pending,
      // never send a prompt carrying the superseded capability.
      const currentGenerationId = String(state?.generationIdBySide?.[normalizedSide] || "");
      if (!generationMatches(currentGenerationId, incomingGenerationId)) {
        throw new Error(`AI ${normalizedSide || "?"} generation changed while arming provider dispatch.`);
      }
      return true;
    };
    armingHelperAttached = true;
  }

  let providerBoundaryAttached = false;
  if (
    armingHelperAttached &&
    typeof chrome !== "undefined" &&
    chrome?.tabs &&
    typeof chrome.tabs.sendMessage === "function" &&
    typeof sideForTab === "function"
  ) {
    const baseTabSendMessage = chrome.tabs.sendMessage.bind(chrome.tabs);

    // The legacy coordinator assigns generationIdBySide immediately before its
    // AI_BRIDGE_SEND call. Intercept only coordinator-owned sends: the message's
    // generation must currently be armed in exactly one logical side. Synthetic
    // transport-level AI_BRIDGE_SEND exercises that never arm coordinator state
    // pass through unchanged, while real Bridge dispatches must also target the
    // currently bound tab for that armed side.
    chrome.tabs.sendMessage = async function generationHardenedTabSendMessage(tabId, message, ...rest) {
      if (message?.type === "AI_BRIDGE_SEND" && message?.generationId) {
        const incomingGenerationId = String(message.generationId || "");
        const armedSides = Object.entries(state?.generationIdBySide || {})
          .filter(([, value]) => String(value || "") === incomingGenerationId)
          .map(([side]) => String(side || "").toUpperCase());

        if (armedSides.length > 1) {
          throw new Error("Provider dispatch generation is armed for multiple logical sides.");
        }

        if (armedSides.length === 1) {
          const side = armedSides[0];
          if (sideForTab(Number(tabId)) !== side) {
            throw new Error(`Provider dispatch generation for AI ${side} does not target its current bound tab.`);
          }
          await globalThis.persistArmedGenerationBeforeProviderSend(side, incomingGenerationId);
        }
      }
      return baseTabSendMessage(tabId, message, ...rest);
    };
    providerBoundaryAttached = true;
  }

  let consumptionAttached = false;
  let conversationBindingAttached = false;

  function responseConversationMatches(side, pageUrl) {
    if (!caps || caps.version !== 1 || typeof caps.conversationIdentity !== "function") return false;
    const normalizedSide = String(side || "").toUpperCase();
    const tabId = Number(typeof tabForSide === "function" ? tabForSide(normalizedSide) : state?.[`tab${normalizedSide}`]);
    const expected = state?.viewpointIdentityBySide?.[normalizedSide] || null;
    const observed = caps.conversationIdentity({ side: normalizedSide, tabId, url: String(pageUrl || "") });
    if (!expected || !observed) return false;
    return String(expected.provenanceId || "") === String(observed.provenanceId || "") &&
      String(expected.threadKey || "") === String(observed.threadKey || "") &&
      String(expected.providerFamily || "") === String(observed.familyId || "") &&
      Number(expected.boundTabId) === Number(observed.tabId);
  }

  if (typeof handleCompletedResponse === "function" && persistenceAvailable) {
    const baseHandleCompletedResponse = handleCompletedResponse;

    // The background listener performs an early generation check before placing
    // a response into responseCommitQueue. Two near-simultaneous deliveries can
    // both pass that early check before either commits. Re-check here because
    // this function is invoked by the serialized queue task, then consume and
    // durably persist the accepted token before response processing can advance
    // the cursor or wait for the next dispatch. A duplicate queued behind it —
    // or a worker restarted after consumption — therefore fails closed.
    handleCompletedResponse = async function generationHardenedHandleCompletedResponse(side, text, options = {}) {
      const normalizedSide = String(side || "").toUpperCase();
      const incomingGenerationId = String(options?.generationId || "");
      const expectedGenerationId = String(state?.generationIdBySide?.[normalizedSide] || "");
      const responsePageUrl = String(options?.pageUrl || "");

      // Sender-tab and generation authority are necessary but not sufficient on
      // modern provider SPAs: the same content script can survive navigation to
      // another conversation. Require the current response page to match the
      // exact trusted conversation identity captured when this generation was
      // dispatched. Reject before consuming the token so navigation noise does
      // not destroy an otherwise recoverable generation capability.
      if (!responseConversationMatches(normalizedSide, responsePageUrl)) {
        try {
          appendLog({
            time: Date.now(),
            type: "stale-response",
            side: normalizedSide || null,
            text: `Ignored response from AI ${normalizedSide || "?"} because its conversation identity changed after dispatch`
          });
        } catch (_) {}
        return { ok: false, ignored: true, staleConversation: true };
      }

      if (!generationMatches(expectedGenerationId, incomingGenerationId)) {
        try {
          appendLog({
            time: Date.now(),
            type: "stale-response",
            side: normalizedSide || null,
            text: `Ignored response from AI ${normalizedSide || "?"} because its generation was no longer armed at serialized commit`
          });
        } catch (_) {}
        return { ok: false, ignored: true, staleGeneration: true };
      }

      // Consume before delegating. The delegated handler may eventually dispatch
      // another prompt to this same side and arm a newer generation; clearing
      // only after delegation could accidentally destroy that fresh token.
      state.generationIdBySide = {
        ...(state.generationIdBySide && typeof state.generationIdBySide === "object" ? state.generationIdBySide : {}),
        [normalizedSide]: null
      };

      // MV3 workers are disposable. Persist the disarm before any further
      // response processing so a worker termination, an ignored/duplicate early
      // return, or a later handler error cannot resurrect the consumed token from
      // chrome.storage.local on restart. This intentionally favors fail-closed
      // authorization over replaying an incompletely committed provider reply.
      await persistGenerationState();

      return baseHandleCompletedResponse(side, text, options);
    };
    consumptionAttached = true;
    conversationBindingAttached = Boolean(caps && caps.version === 1 && typeof caps.conversationIdentity === "function");
  }

  let failedDispatchRollbackAttached = false;
  if (typeof sendToSide === "function" && persistenceAvailable) {
    const baseSendToSide = sendToSide;
    sendToSide = async function generationHardenedSendToSide(...args) {
      try {
        return await baseSendToSide(...args);
      } catch (error) {
        // Viewpoint/runtime dispatch wrappers clear transient identity and the
        // armed generation before propagating a final send failure. Persist the
        // resulting state immediately so a restart cannot restore a token for a
        // prompt that the provider never accepted.
        await persistGenerationState();
        throw error;
      }
    };
    failedDispatchRollbackAttached = true;
  }

  // Unit tests may intentionally load only the matcher. Production bootstrap
  // requires every response/dispatch capability below, so a missing coordinator,
  // provider-boundary, or persistence hook still fails closed in the real worker.
  globalThis.__AI_BRIDGE_GENERATION_SECURITY__ = Object.freeze({
    version: 5,
    failClosedWhenUnarmed: true,
    durablyArmsGenerationBeforeProviderSend: providerBoundaryAttached,
    providerSendBoundaryGuarded: providerBoundaryAttached,
    rechecksArmedGenerationAfterPersistence: armingHelperAttached,
    durablyClearsFailedDispatchGeneration: failedDispatchRollbackAttached,
    rechecksGenerationAtSerializedCommit: consumptionAttached,
    consumesAcceptedGenerationBeforeCommit: consumptionAttached,
    durablyPersistsConsumedGenerationBeforeCommit: consumptionAttached,
    preservesNewerGenerationArmedByCommit: consumptionAttached,
    preventsSequentialReplayWindow: consumptionAttached,
    preventsRestartGenerationResurrection: consumptionAttached,
    requiresAutomaticResponsePageIdentity: conversationBindingAttached,
    rejectsCrossThreadSpaResponseBeforeConsumption: conversationBindingAttached
  });
})();
