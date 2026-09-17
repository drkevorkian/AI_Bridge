(() => {
  "use strict";

  // Same-provider viewpoint runtime. Conversation identity is captured before
  // provider dispatch, stamped into response transcript entries during the
  // normal commit, and duplicated provider families share a deterministic send
  // queue. Viewpoint mode always fails closed without trusted dispatch identity.
  const FLAG = "__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__";
  if (globalThis[FLAG]) return;

  const caps = globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__;
  if (!caps || caps.version !== 1 || typeof caps.conversationIdentity !== "function" || typeof caps.sameFamilySendPlan !== "function") {
    throw new Error("Viewpoint runtime requires the conversation-identity contract.");
  }
  if (caps.duplicateProviderAgentsEnabled !== true) {
    throw new Error("Viewpoint runtime activation requires duplicate-provider mode.");
  }

  const familyQueues = new Map();

  function liveSides() {
    const dynamic = globalThis.__AI_BRIDGE_DYNAMIC_AGENTS_V1__;
    if (typeof dynamic?.liveSides === "function") return [...dynamic.liveSides()];
    return Array.isArray(SIDES) && SIDES.length ? [...SIDES] : ["A", "B", "C"];
  }

  async function tabUrl(tabId) {
    if (!Number.isInteger(Number(tabId)) || Number(tabId) <= 0) return "";
    try {
      const tab = await chrome.tabs.get(Number(tabId));
      return String(tab?.url || "");
    } catch (_) {
      return "";
    }
  }

  async function identityForSide(side) {
    const tabId = typeof tabForSide === "function" ? Number(tabForSide(side)) : 0;
    return caps.conversationIdentity({ side, tabId, url: await tabUrl(tabId) });
  }

  function sanitizedIdentity(identity) {
    if (!identity) return null;
    return {
      provenanceId: String(identity.provenanceId || ""),
      threadKey: String(identity.threadKey || ""),
      providerFamily: String(identity.familyId || ""),
      boundTabId: Number(identity.tabId) || null
    };
  }

  function requireDispatchIdentity(identity) {
    if (!identity) {
      throw new Error("Viewpoint dispatch requires a trusted conversation identity.");
    }
    return identity;
  }

  function sameIdentity(left, right) {
    if (!left || !right) return false;
    return left.provenanceId === right.provenanceId &&
      left.threadKey === right.threadKey &&
      left.providerFamily === right.providerFamily &&
      left.boundTabId === right.boundTabId;
  }

  function rememberIdentity(side, identity) {
    const safe = sanitizedIdentity(identity);
    state.viewpointIdentityBySide = {
      ...(state.viewpointIdentityBySide && typeof state.viewpointIdentityBySide === "object" ? state.viewpointIdentityBySide : {}),
      [side]: safe
    };
    return safe;
  }

  function stampEntry(entry, identity) {
    if (!entry || typeof entry !== "object" || !identity) return entry;
    entry.provenanceId = identity.provenanceId;
    entry.threadKey = identity.threadKey;
    entry.providerFamily = identity.providerFamily;
    entry.boundTabId = identity.boundTabId;
    return entry;
  }

  async function currentAssignments() {
    const rows = [];
    for (const side of liveSides()) {
      const tabId = typeof tabForSide === "function" ? Number(tabForSide(side)) : 0;
      rows.push({ side, tabId, url: await tabUrl(tabId) });
    }
    return rows;
  }

  function validateAssignments(assignments) {
    const verdict = caps.evaluateAgentBindings(assignments, {
      duplicateProviderAgentsEnabled: true
    });
    if (!verdict.ok) {
      throw new Error(verdict.errors[0]?.message || "Viewpoint binding policy rejected this send.");
    }
    return verdict;
  }

  function enqueueFamily(familyId, work) {
    const key = familyId || "unknown";
    const previous = familyQueues.get(key) || Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    familyQueues.set(key, next);
    next.finally(() => {
      if (familyQueues.get(key) === next) familyQueues.delete(key);
    }).catch(() => {});
    return next;
  }

  if (typeof recordTranscript === "function") {
    const baseRecordTranscript = recordTranscript;
    recordTranscript = function viewpointRecordTranscript(type, payload = {}) {
      const entry = baseRecordTranscript(type, payload);
      if (type === "response" && payload?.side) {
        const identity = state?.viewpointIdentityBySide?.[payload.side] || null;
        if (identity) stampEntry(entry, identity);
      }
      return entry;
    };
  }

  if (typeof sendToSide === "function") {
    const baseSend = sendToSide;
    sendToSide = async function viewpointSendToSide(side, text, options) {
      // First snapshot establishes the user's intended tab/thread and determines
      // whether this provider family needs serialization. This is not enough by
      // itself: a queued tab may navigate while another same-family send runs.
      const assignments = await currentAssignments();
      validateAssignments(assignments);
      const plan = caps.sameFamilySendPlan(assignments);
      const row = assignments.find(item => item.side === side) || null;
      const initialRawIdentity = row ? caps.conversationIdentity(row) : await identityForSide(side);
      const intendedIdentity = sanitizedIdentity(requireDispatchIdentity(initialRawIdentity));
      const familyId = intendedIdentity.providerFamily;
      const queue = plan.queues.find(item => item.familyId === familyId);

      const run = async () => {
        // Re-resolve immediately before provider dispatch. If the side was
        // rebound or its tab navigated while waiting in the family queue, fail
        // closed instead of sending to a different thread with stale provenance.
        const dispatchAssignments = await currentAssignments();
        validateAssignments(dispatchAssignments);
        const dispatchRow = dispatchAssignments.find(item => item.side === side) || null;
        const dispatchRawIdentity = dispatchRow ? caps.conversationIdentity(dispatchRow) : await identityForSide(side);
        const dispatchIdentity = sanitizedIdentity(requireDispatchIdentity(dispatchRawIdentity));
        if (!sameIdentity(intendedIdentity, dispatchIdentity)) {
          throw new Error("Viewpoint binding changed while queued; refusing dispatch to preserve conversation provenance.");
        }

        rememberIdentity(side, dispatchRawIdentity);
        const result = await baseSend(side, text, options);
        if (options?.record === false && typeof saveState === "function") {
          await saveState();
        }
        return result;
      };

      if (caps.serializeSameFamilySends === true && queue?.serialize) {
        return enqueueFamily(familyId, run);
      }
      return run();
    };
  }

  globalThis.viewpointIdentityForSide = identityForSide;
  globalThis.requireViewpointDispatchIdentity = requireDispatchIdentity;
  globalThis[FLAG] = Object.freeze({
    version: 1,
    stampsTranscript: true,
    stampsBeforeCommitSave: true,
    capturesIdentityBeforeDispatch: true,
    failsClosedWithoutDispatchIdentityWhenEnabled: true,
    serializesSameFamilySends: true,
    validatesBindingsBeforeSend: true,
    revalidatesIdentityAtDispatch: true,
    enablesDuplicateProviders: true
  });
})();
