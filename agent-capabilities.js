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
    duplicateProviderAgentsEnabled: false
  });
})();
