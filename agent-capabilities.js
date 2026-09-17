// AI Bridge logical-agent capability contract.
//
// This file intentionally defines capabilities only. It does not change the
// coordinator's current A/B/C routing by itself. The dynamic-agent migration
// can therefore consume one audited source of truth without making a partially
// migrated dashboard appear to support more agents than the coordinator can
// actually route.
//
// Current policy: one logical agent per supported provider family, so the
// selectable count is 1..5. A future, separately reviewed multi-tab viewpoint
// mode may lift that policy by allowing multiple logical agents to use distinct
// tabs from the same provider. That mode is deliberately NOT enabled here.
(() => {
  "use strict";

  const PROVIDER_FAMILIES = Object.freeze([
    Object.freeze({ id: "chatgpt", name: "ChatGPT", hosts: Object.freeze(["chatgpt.com", "chat.openai.com"]) }),
    Object.freeze({ id: "grok", name: "Grok", hosts: Object.freeze(["grok.com"]) }),
    Object.freeze({ id: "claude", name: "Claude", hosts: Object.freeze(["claude.ai"]) }),
    Object.freeze({ id: "gemini", name: "Gemini", hosts: Object.freeze(["gemini.google.com"]) }),
    Object.freeze({ id: "copilot", name: "Copilot", hosts: Object.freeze(["copilot.microsoft.com"]) })
  ]);

  const DEFAULT_AGENT_COUNT = 3;
  const MAX_UNIQUE_PROVIDER_AGENTS = PROVIDER_FAMILIES.length;
  const SIDE_ALPHABET = Object.freeze("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""));
  const SUPPORTED_AGENT_SIDES = Object.freeze(SIDE_ALPHABET.slice(0, MAX_UNIQUE_PROVIDER_AGENTS));

  function parseAgentCount(raw) {
    if (raw === null || raw === undefined || raw === "") return null;
    const value = Number(raw);
    if (!Number.isInteger(value)) return null;
    if (value < 1 || value > MAX_UNIQUE_PROVIDER_AGENTS) return null;
    return value;
  }

  function normalizeAgentCount(raw, fallback = DEFAULT_AGENT_COUNT) {
    const parsed = parseAgentCount(raw);
    if (parsed !== null) return parsed;
    const safeFallback = parseAgentCount(fallback);
    return safeFallback === null ? DEFAULT_AGENT_COUNT : safeFallback;
  }

  function sideIdsForCount(raw) {
    const count = parseAgentCount(raw);
    if (count === null) {
      throw new RangeError(`Agent count must be an integer from 1 to ${MAX_UNIQUE_PROVIDER_AGENTS}.`);
    }
    return SUPPORTED_AGENT_SIDES.slice(0, count);
  }

  function providerFamilyForUrl(rawUrl) {
    let parsed;
    try {
      parsed = new URL(String(rawUrl || ""));
    } catch (_) {
      return null;
    }
    if (parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase();
    return PROVIDER_FAMILIES.find(provider => provider.hosts.includes(host)) || null;
  }

  function isSupportedProviderUrl(rawUrl) {
    return Boolean(providerFamilyForUrl(rawUrl));
  }

  // Stable conversation identity for one bound tab.
  // Query/hash are dropped so tokens and ephemeral UI state never become IDs.
  // Two tabs of the same provider are independent viewpoints only when their
  // path-level thread keys differ.
  function conversationIdentity(assignment) {
    const side = String(assignment?.side || "").toUpperCase();
    const tabId = Number(assignment?.tabId);
    const family = providerFamilyForUrl(assignment?.url || "");
    if (!family || !Number.isInteger(tabId) || tabId <= 0) return null;
    let parsed;
    try {
      parsed = new URL(String(assignment.url));
    } catch (_) {
      return null;
    }
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    const threadKey = `${parsed.protocol}//${parsed.hostname.toLowerCase()}${path}`;
    return Object.freeze({
      side,
      tabId,
      familyId: family.id,
      host: parsed.hostname.toLowerCase(),
      threadKey,
      provenanceId: `${family.id}:tab:${tabId}:${threadKey}`
    });
  }

  // Future same-provider sends must be serialized per family even though each
  // agent already owns a private tab. Shared cookies/quotas are the risk.
  function sameFamilySendPlan(assignments) {
    const identities = (Array.isArray(assignments) ? assignments : [])
      .map(conversationIdentity)
      .filter(Boolean);
    const byFamily = new Map();
    for (const identity of identities) {
      const list = byFamily.get(identity.familyId) || [];
      list.push(identity);
      byFamily.set(identity.familyId, list);
    }
    const queues = [];
    for (const [familyId, owners] of byFamily.entries()) {
      queues.push(Object.freeze({
        familyId,
        serialize: owners.length > 1,
        sides: Object.freeze(owners.map(item => item.side)),
        tabIds: Object.freeze(owners.map(item => item.tabId))
      }));
    }
    return Object.freeze({
      serializePerTab: true,
      serializeDuplicatedFamilies: true,
      queues: Object.freeze(queues)
    });
  }

  // Binding security evaluator.
  // unique tab IDs are a hard invariant. Same-provider / multi-tab viewpoint
  // mode may later allow two logical agents to share a provider *family*
  // only when they own different browser tabs. That mode is off by default.
  function evaluateAgentBindings(assignments, options = {}) {
    const rows = Array.isArray(assignments) ? assignments : [];
    const allowDuplicateFamilies = options.duplicateProviderAgentsEnabled === true;
    const errors = [];
    const byTab = new Map();
    const byFamily = new Map();

    rows.forEach((row, index) => {
      const side = String(row?.side || "").toUpperCase() || `#${index}`;
      const tabId = Number(row?.tabId);
      if (!Number.isInteger(tabId) || tabId <= 0) {
        errors.push({ code: "INVALID_TAB", side, message: `AI ${side} is not bound to a valid browser tab.` });
        return;
      }
      const family = providerFamilyForUrl(row?.url || "");
      if (!family) {
        errors.push({ code: "UNSUPPORTED", side, message: `AI ${side} is not bound to a trusted HTTPS AI provider.` });
        return;
      }
      const tabOwners = byTab.get(tabId) || [];
      tabOwners.push(side);
      byTab.set(tabId, tabOwners);
      const familyOwners = byFamily.get(family.id) || [];
      familyOwners.push(side);
      byFamily.set(family.id, familyOwners);
    });

    for (const [tabId, owners] of byTab.entries()) {
      if (owners.length > 1) {
        errors.push({
          code: "DUPLICATE_TAB",
          sides: Object.freeze(owners.slice()),
          tabId,
          message: `Tab ${tabId} cannot host more than one logical agent (${owners.join(", ")}).`
        });
      }
    }

    if (!allowDuplicateFamilies) {
      for (const [familyId, owners] of byFamily.entries()) {
        if (owners.length > 1) {
          errors.push({
            code: "DUPLICATE_PROVIDER",
            sides: Object.freeze(owners.slice()),
            familyId,
            message: `Provider family ${familyId} is already bound to ${owners.join(", ")}. Duplicate-provider viewpoint mode is disabled.`
          });
        }
      }
    } else {
      const byThread = new Map();
      for (const row of rows) {
        const identity = conversationIdentity(row);
        if (!identity) continue;
        const key = `${identity.familyId}::${identity.threadKey}`;
        const owners = byThread.get(key) || [];
        owners.push(identity.side);
        byThread.set(key, owners);
      }
      for (const [key, owners] of byThread.entries()) {
        if (owners.length > 1) {
          errors.push({
            code: "DUPLICATE_THREAD",
            sides: Object.freeze(owners.slice()),
            threadKey: key,
            message: `Same-provider viewpoint mode requires distinct conversation threads (${owners.join(", ")} share ${key}).`
          });
        }
      }
    }

    return Object.freeze({
      ok: errors.length === 0,
      allowDuplicateFamilies,
      uniqueTabBinding: true,
      errors: Object.freeze(errors.map(item => Object.freeze(item)))
    });
  }

  globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__ = Object.freeze({
    version: 1,
    defaultAgentCount: DEFAULT_AGENT_COUNT,
    maxUniqueProviderAgents: MAX_UNIQUE_PROVIDER_AGENTS,
    supportedAgentSides: SUPPORTED_AGENT_SIDES,
    providerFamilies: PROVIDER_FAMILIES,
    parseAgentCount,
    normalizeAgentCount,
    sideIdsForCount,
    providerFamilyForUrl,
    isSupportedProviderUrl,
    conversationIdentity,
    sameFamilySendPlan,
    evaluateAgentBindings,
    uniqueTabBinding: true,
    uniqueTabBindingNeverRelaxed: true,
    distinctThreadRequiredWhenSameFamily: true,
    serializeSameFamilySends: true,
    duplicateProviderAgentsEnabled: false
  });
})();
