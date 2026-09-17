(() => {
  "use strict";

  // Slice 2 scaffolding on the Slice 1 baseline.
  // Capture sanitized conversation identity before provider dispatch, stamp it
  // synchronously into response transcript entries during the normal commit,
  // and serialize sends when more than one live agent shares a provider family.
  // duplicateProviderAgentsEnabled stays false.
  const FLAG = "__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__";
  if (globalThis[FLAG]) return;

  const caps = globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__;
  if (!caps || caps.version !== 1 || typeof caps.conversationIdentity !== "function" || typeof caps.sameFamilySendPlan !== "function") {
    throw new Error("Viewpoint runtime requires the conversation-identity contract.");
  }
  if (caps.duplicateProviderAgentsEnabled === true) {
    throw new Error("Viewpoint runtime must not boot while duplicate-provider mode is enabled.");
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

  function enqueueFamily(familyId, work) {
    const key = familyId || "unknown";
    const previous = familyQueues.get(key) || Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    familyQueues.set(key, next);
    return next;
  }

  // Stamp inside recordTranscript so the base response handler persists the
  // provenance fields in the same save as the response itself. Never resolve
  // the current tab URL after completion: navigation after dispatch must not
  // rewrite which conversation actually received the prompt.
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
      const assignments = await currentAssignments();
      const plan = caps.sameFamilySendPlan(assignments);
      const row = assignments.find(item => item.side === side) || null;
      const identity = row ? caps.conversationIdentity(row) : await identityForSide(side);
      const remembered = rememberIdentity(side, identity);
      const familyId = remembered?.providerFamily || "unknown";
      const queue = plan.queues.find(item => item.familyId === familyId);
      const run = async () => {
        const result = await baseSend(side, text, options);
        // Normal recorded sends persist state inside baseSend. Resends use
        // record:false, so explicitly persist the captured identity after a
        // successful resend to survive service-worker suspension.
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
  globalThis[FLAG] = Object.freeze({
    version: 1,
    stampsTranscript: true,
    stampsBeforeCommitSave: true,
    capturesIdentityBeforeDispatch: true,
    serializesSameFamilySends: true,
    enablesDuplicateProviders: false
  });
})();
