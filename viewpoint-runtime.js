(() => {
  "use strict";

  // Slice 2 scaffolding on the Slice 1 baseline.
  // Stamp sanitized thread identity onto recorded responses and serialize
  // provider-family sends when more than one live agent shares that family.
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

  function stampEntry(entry, identity) {
    if (!entry || typeof entry !== "object" || !identity) return entry;
    entry.provenanceId = identity.provenanceId;
    entry.threadKey = identity.threadKey;
    entry.providerFamily = identity.familyId;
    entry.boundTabId = identity.tabId;
    return entry;
  }

  async function stampResponseNow(side, entry) {
    const identity = await identityForSide(side);
    if (identity && entry) stampEntry(entry, identity);
    return identity;
  }

  async function latestResponseEntry(side) {
    const list = Array.isArray(state?.transcript) ? state.transcript : [];
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const entry = list[index];
      if (entry?.type === "response" && entry.side === side) return entry;
    }
    return null;
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

  if (typeof handleCompletedResponse === "function") {
    const baseHandle = handleCompletedResponse;
    handleCompletedResponse = async function viewpointHandleCompletedResponse(side, text, options) {
      const result = await baseHandle(side, text, options);
      const entry = await latestResponseEntry(side);
      if (entry) await stampResponseNow(side, entry);
      return result;
    };
  }

  if (typeof handleBatchCompletedResponse === "function") {
    const baseBatch = handleBatchCompletedResponse;
    handleBatchCompletedResponse = async function viewpointHandleBatchCompletedResponse(side, text, options) {
      const result = await baseBatch(side, text, options);
      const entry = await latestResponseEntry(side);
      if (entry) await stampResponseNow(side, entry);
      return result;
    };
  }

  if (typeof sendToSide === "function") {
    const baseSend = sendToSide;
    sendToSide = async function viewpointSendToSide(side, text, options) {
      const plan = caps.sameFamilySendPlan(await currentAssignments());
      const identity = await identityForSide(side);
      const familyId = identity?.familyId || "unknown";
      const queue = plan.queues.find(item => item.familyId === familyId);
      const run = () => baseSend(side, text, options);
      if (caps.serializeSameFamilySends === true && queue?.serialize) {
        return enqueueFamily(familyId, run);
      }
      return run();
    };
  }

  globalThis.stampViewpointProvenance = stampResponseNow;
  globalThis[FLAG] = Object.freeze({
    version: 1,
    stampsTranscript: true,
    serializesSameFamilySends: true,
    enablesDuplicateProviders: false
  });
})();
