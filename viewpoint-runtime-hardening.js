(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__";
  if (globalThis[FLAG]) return;

  const caps = globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__;
  const dynamic = globalThis.__AI_BRIDGE_DYNAMIC_AGENTS_V1__;
  if (
    !caps || caps.version !== 1 ||
    !dynamic || dynamic.version !== 1 ||
    caps.uniqueTabBindingNeverRelaxed !== true ||
    caps.distinctThreadRequiredWhenSameFamily !== true ||
    caps.serializeSameFamilySends !== true ||
    typeof caps.conversationIdentity !== "function" ||
    typeof caps.sameFamilySendPlan !== "function"
  ) {
    throw new Error("Viewpoint runtime requires the audited dynamic-agent identity contract.");
  }

  const tabQueues = new Map();
  const familyQueues = new Map();

  function liveState() {
    try {
      if (typeof state !== "undefined" && state) return state;
    } catch (_) {}
    return globalThis.state || null;
  }

  function liveSides() {
    return typeof dynamic.liveSides === "function" ? [...dynamic.liveSides()] : ["A", "B", "C"];
  }

  function ensureIdentityMap() {
    const current = liveState();
    if (!current) return {};
    if (!current.conversationIdentityBySide || typeof current.conversationIdentityBySide !== "object" || Array.isArray(current.conversationIdentityBySide)) {
      current.conversationIdentityBySide = {};
    }
    return current.conversationIdentityBySide;
  }

  function sanitizeIdentity(identity) {
    if (!identity) return null;
    return Object.freeze({
      side: String(identity.side || "").toUpperCase(),
      tabId: Number(identity.tabId),
      familyId: String(identity.familyId || ""),
      host: String(identity.host || ""),
      threadKey: String(identity.threadKey || ""),
      provenanceId: String(identity.provenanceId || "")
    });
  }

  async function identityForSide(side) {
    const normalizedSide = String(side || "").toUpperCase();
    if (!liveSides().includes(normalizedSide)) return null;
    const tabId = Number(typeof tabForSide === "function" ? tabForSide(normalizedSide) : liveState()?.[`tab${normalizedSide}`]);
    if (!Number.isInteger(tabId) || tabId <= 0) return null;
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (_) {
      return null;
    }
    return sanitizeIdentity(caps.conversationIdentity({ side: normalizedSide, tabId, url: tab?.url || "" }));
  }

  async function refreshConversationIdentities() {
    const map = ensureIdentityMap();
    const sides = liveSides();
    for (const key of Object.keys(map)) {
      if (!sides.includes(key)) delete map[key];
    }
    for (const side of sides) {
      const identity = await identityForSide(side);
      if (identity) map[side] = identity;
      else delete map[side];
    }
    return map;
  }

  function identitySnapshot(side) {
    const identity = ensureIdentityMap()[String(side || "").toUpperCase()];
    return identity ? { ...identity } : null;
  }

  function transcriptProvenance(side) {
    const identity = identitySnapshot(side);
    if (!identity) return {};
    return {
      provenanceId: identity.provenanceId,
      providerFamilyId: identity.familyId,
      providerTabId: identity.tabId,
      providerThreadKey: identity.threadKey
    };
  }

  function enqueue(queueMap, key, task) {
    const previous = queueMap.get(key) || Promise.resolve();
    const run = previous.catch(() => {}).then(task);
    const tail = run.catch(() => {});
    queueMap.set(key, tail);
    tail.finally(() => {
      if (queueMap.get(key) === tail) queueMap.delete(key);
    });
    return run;
  }

  function duplicatedFamilyFor(identity, identities) {
    if (!identity || caps.duplicateProviderAgentsEnabled !== true) return false;
    const rows = Object.values(identities || {}).filter(Boolean);
    const plan = caps.sameFamilySendPlan(rows.map(item => ({
      side: item.side,
      tabId: item.tabId,
      url: item.threadKey
    })));
    return Boolean(plan.queues.find(queue => queue.familyId === identity.familyId)?.serialize);
  }

  if (typeof migrateDynamicAgentState === "function") {
    const baseMigrate = migrateDynamicAgentState;
    migrateDynamicAgentState = function viewpointMigrateDynamicAgentState(bridgeState) {
      const next = baseMigrate(bridgeState);
      if (!next.conversationIdentityBySide || typeof next.conversationIdentityBySide !== "object" || Array.isArray(next.conversationIdentityBySide)) {
        next.conversationIdentityBySide = {};
      }
      return next;
    };
    globalThis.migrateDynamicAgentState = migrateDynamicAgentState;
  }

  if (typeof bindTabsFromMessage === "function") {
    const baseBindTabsFromMessage = bindTabsFromMessage;
    bindTabsFromMessage = async function viewpointBindTabsFromMessage(msg) {
      const result = await baseBindTabsFromMessage.apply(this, arguments);
      await refreshConversationIdentities();
      return result;
    };
  }

  if (typeof recordTranscript === "function") {
    const baseRecordTranscript = recordTranscript;
    recordTranscript = function viewpointRecordTranscript(type, payload = {}) {
      const side = payload && typeof payload === "object" ? payload.side : null;
      const enriched = side ? { ...payload, ...transcriptProvenance(side) } : payload;
      return baseRecordTranscript(type, enriched);
    };
  }

  if (typeof sendToSide === "function") {
    const baseSendToSide = sendToSide;
    sendToSide = async function viewpointSerializedSendToSide(side) {
      const normalizedSide = String(side || "").toUpperCase();
      await refreshConversationIdentities();
      const identities = ensureIdentityMap();
      const identity = identities[normalizedSide];
      if (!identity) {
        throw new Error(`AI ${normalizedSide} does not have a valid trusted conversation identity.`);
      }
      const invokeBase = () => baseSendToSide.apply(this, arguments);
      const perTab = () => enqueue(tabQueues, `tab:${identity.tabId}`, invokeBase);
      if (duplicatedFamilyFor(identity, identities)) {
        return enqueue(familyQueues, `family:${identity.familyId}`, perTab);
      }
      return perTab();
    };
  }

  globalThis[FLAG] = Object.freeze({
    version: 1,
    enabled: false,
    stampsTranscriptProvenance: true,
    serializesPerTab: true,
    serializesDuplicateFamiliesWhenEnabled: true,
    uniqueTabBindingNeverRelaxed: true,
    refreshConversationIdentities,
    identitySnapshot
  });
})();
