// AI Bridge logical-agent capability contract.
//
// Logical-agent identity is independent from provider-family identity. Up to
// five logical slots (A-E) are currently exposed by the UI, and multiple slots
// may use distinct tabs from the same provider when their sanitized thread
// identities differ. One logical agent per unique Chrome tab is permanent.
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

  // Provider-family count and logical-agent capacity are intentionally separate.
  // Multiple logical agents may use different tabs/conversations from the same
  // provider family, so the number of provider families must never implicitly
  // cap the number of logical viewpoints. Keep the visible/runtime ceiling at
  // five for v1.17.1; later slices can raise MAX_LOGICAL_AGENTS without changing
  // provider discovery or weakening any same-provider isolation rule.
  const PROVIDER_FAMILY_COUNT = PROVIDER_FAMILIES.length;
  const MAX_LOGICAL_AGENTS = 5;

  // Compatibility alias retained for older v1.17.1 modules/tests that still
  // consume this property name. Its meaning is now explicitly the logical-slot
  // ceiling, not the number of unique provider families.
  const MAX_UNIQUE_PROVIDER_AGENTS = MAX_LOGICAL_AGENTS;

  const SIDE_ALPHABET = Object.freeze("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""));
  const SUPPORTED_AGENT_SIDES = Object.freeze(SIDE_ALPHABET.slice(0, MAX_LOGICAL_AGENTS));
  const LEGACY_ALIAS_LIMIT = 5;
  const CANONICAL_AGENT_ID_PATTERN = /^agent-([1-9][0-9]*)$/;
  const DUPLICATE_PROVIDER_AGENTS_ENABLED = true;

  // Canonical logical-agent identity is intentionally independent from the
  // current five-slot runtime ceiling. Stable IDs therefore keep working for
  // ordinals above E even before persistence/UI support for F+ is enabled.
  function agentIdForOrdinal(rawOrdinal) {
    const ordinal = Number(rawOrdinal);
    if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
      throw new RangeError("Agent ordinal must be a positive safe integer.");
    }
    return `agent-${ordinal}`;
  }

  function ordinalForAgentId(rawId) {
    if (typeof rawId !== "string") return null;
    const match = CANONICAL_AGENT_ID_PATTERN.exec(rawId);
    if (!match) return null;
    const ordinal = Number(match[1]);
    return Number.isSafeInteger(ordinal) && ordinal >= 1 ? ordinal : null;
  }

  function isCanonicalAgentId(rawId) {
    return ordinalForAgentId(rawId) !== null;
  }

  function legacySideForOrdinal(rawOrdinal) {
    const ordinal = Number(rawOrdinal);
    if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > LEGACY_ALIAS_LIMIT) return null;
    return SIDE_ALPHABET[ordinal - 1] || null;
  }

  function ordinalForLegacySide(rawSide) {
    if (typeof rawSide !== "string") return null;
    const side = rawSide.toUpperCase();
    if (!/^[A-E]$/.test(side)) return null;
    return SIDE_ALPHABET.indexOf(side) + 1;
  }

  // Runtime map keys preserve A-E for compatibility, while ordinals above the
  // legacy alias window use their canonical machine IDs directly. This helper
  // is intentionally independent from MAX_LOGICAL_AGENTS so F+ identity can be
  // normalized before the active-capacity gate is raised.
  function runtimeAgentKeyForOrdinal(rawOrdinal) {
    const ordinal = Number(rawOrdinal);
    if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
      throw new RangeError("Agent ordinal must be a positive safe integer.");
    }
    return legacySideForOrdinal(ordinal) || agentIdForOrdinal(ordinal);
  }

  function ordinalForRuntimeAgentKey(rawKey) {
    const legacyOrdinal = ordinalForLegacySide(rawKey);
    if (legacyOrdinal !== null) return legacyOrdinal;
    return ordinalForAgentId(rawKey);
  }

  function parseAgentCount(raw) {
    if (raw === null || raw === undefined || raw === "") return null;
    const value = Number(raw);
    if (!Number.isInteger(value)) return null;
    if (value < 1 || value > MAX_LOGICAL_AGENTS) return null;
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
      throw new RangeError(`Agent count must be an integer from 1 to ${MAX_LOGICAL_AGENTS}.`);
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

  // Stable conversation identity for one bound tab. Query/hash are dropped so
  // tokens and ephemeral page state never participate in logical identity.
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

  // Same-family tabs are serialized as a provider-family queue. Each logical
  // agent still owns a distinct tab/content-script instance.
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

  // Central binding security evaluator. Unique tab IDs are never relaxed.
  // When same-provider viewpoints are enabled, provider-family duplication is
  // allowed only across distinct tabs and distinct sanitized conversation
  // threads.
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
    providerFamilyCount: PROVIDER_FAMILY_COUNT,
    maxLogicalAgents: MAX_LOGICAL_AGENTS,
    maxUniqueProviderAgents: MAX_UNIQUE_PROVIDER_AGENTS,
    supportedAgentSides: SUPPORTED_AGENT_SIDES,
    legacyAliasLimit: LEGACY_ALIAS_LIMIT,
    canonicalAgentIdPattern: CANONICAL_AGENT_ID_PATTERN,
    providerFamilies: PROVIDER_FAMILIES,
    parseAgentCount,
    normalizeAgentCount,
    sideIdsForCount,
    agentIdForOrdinal,
    ordinalForAgentId,
    isCanonicalAgentId,
    legacySideForOrdinal,
    ordinalForLegacySide,
    runtimeAgentKeyForOrdinal,
    ordinalForRuntimeAgentKey,
    providerFamilyForUrl,
    isSupportedProviderUrl,
    conversationIdentity,
    sameFamilySendPlan,
    evaluateAgentBindings,
    uniqueTabBinding: true,
    uniqueTabBindingNeverRelaxed: true,
    distinctThreadRequiredWhenSameFamily: true,
    serializeSameFamilySends: true,
    stableMachineAgentIds: true,
    canonicalAgentIdVersion: 1,
    duplicateProviderAgentsEnabled: DUPLICATE_PROVIDER_AGENTS_ENABLED
  });
})();
