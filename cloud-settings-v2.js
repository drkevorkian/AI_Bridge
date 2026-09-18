(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_CLOUD_SETTINGS_V2__";
  if (globalThis[FLAG]) return;

  const caps = globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__;
  if (
    !caps ||
    caps.version !== 1 ||
    typeof caps.agentIdForOrdinal !== "function" ||
    typeof caps.ordinalForAgentId !== "function" ||
    typeof caps.legacySideForOrdinal !== "function" ||
    typeof caps.ordinalForLegacySide !== "function"
  ) {
    throw new Error("Cloud Settings V2 requires the logical-agent capability contract.");
  }

  const VERSION = 2;
  const MAX_LABEL_CHARS = 240;
  const MAX_JOB_CHARS = 4000;
  const MAX_ACTIVE_AGENTS = Number(caps.maxLogicalAgents) || 5;

  function normalizeCount(raw, fallback = caps.defaultAgentCount || 3) {
    const parsed = typeof caps.parseAgentCount === "function" ? caps.parseAgentCount(raw) : null;
    if (parsed !== null && parsed !== undefined) return parsed;
    const fb = Number(fallback);
    return Number.isInteger(fb) && fb >= 1 && fb <= MAX_ACTIVE_AGENTS ? fb : 3;
  }

  function normalizeAgent(raw, ordinal) {
    const side = caps.legacySideForOrdinal(ordinal);
    if (!side) throw new RangeError("Cloud roster exceeds the active logical-agent ceiling.");
    const expectedId = caps.agentIdForOrdinal(ordinal);
    if (raw && raw.id != null && String(raw.id) !== expectedId) {
      throw new Error("Cloud roster agent ID does not match its ordinal.");
    }
    if (raw && raw.ordinal != null && Number(raw.ordinal) !== ordinal) {
      throw new Error("Cloud roster ordinal is not contiguous.");
    }
    return Object.freeze({
      id: expectedId,
      ordinal,
      label: String(raw?.label ?? `AI ${side}`).slice(0, MAX_LABEL_CHARS),
      job: String(raw?.job ?? "").trim().slice(0, MAX_JOB_CHARS)
    });
  }

  function normalizeRosterV2(rawRoster) {
    if (!rawRoster || typeof rawRoster !== "object" || Array.isArray(rawRoster)) {
      throw new TypeError("Cloud Settings V2 roster must be an object.");
    }
    if (Number(rawRoster.version) !== VERSION || !Array.isArray(rawRoster.agents)) {
      throw new Error("Cloud Settings V2 roster is malformed.");
    }
    const count = rawRoster.agents.length;
    if (count < 1 || count > MAX_ACTIVE_AGENTS) {
      throw new RangeError(`Cloud roster must contain 1 to ${MAX_ACTIVE_AGENTS} active agents.`);
    }
    const agents = rawRoster.agents.map((agent, index) => normalizeAgent(agent, index + 1));
    if (Number(rawRoster.nextOrdinal) !== agents.length + 1) {
      throw new Error("Cloud roster nextOrdinal must follow the active roster.");
    }
    return Object.freeze({
      version: VERSION,
      nextOrdinal: agents.length + 1,
      agents: Object.freeze(agents)
    });
  }

  function rosterFromLegacy(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const count = normalizeCount(src.agentCount, caps.defaultAgentCount || 3);
    const agents = [];
    for (let ordinal = 1; ordinal <= count; ordinal += 1) {
      const side = caps.legacySideForOrdinal(ordinal);
      agents.push(normalizeAgent({
        label: src[`label${side}`] ?? `AI ${side}`,
        job: src[`job${side}`] ?? ""
      }, ordinal));
    }
    return Object.freeze({
      version: VERSION,
      nextOrdinal: count + 1,
      agents: Object.freeze(agents)
    });
  }

  function normalizeRoster(rawSettings) {
    const src = rawSettings && typeof rawSettings === "object" && !Array.isArray(rawSettings)
      ? rawSettings
      : {};
    if (Number(src.schemaVersion) === VERSION || src.roster) {
      return normalizeRosterV2(src.roster);
    }
    return rosterFromLegacy(src);
  }

  function normalizeStartAgentId(rawSettings, roster) {
    const src = rawSettings && typeof rawSettings === "object" && !Array.isArray(rawSettings)
      ? rawSettings
      : {};
    const direct = String(src.startAgentId || "");
    if (direct) {
      const ordinal = caps.ordinalForAgentId(direct);
      if (ordinal !== null && roster.agents.some(agent => agent.id === direct)) return direct;
      throw new Error("Cloud startAgentId is outside the active roster.");
    }

    const side = String(src.startSide || "A").toUpperCase();
    const ordinal = caps.ordinalForLegacySide(side);
    const id = ordinal === null ? null : caps.agentIdForOrdinal(ordinal);
    return id && roster.agents.some(agent => agent.id === id) ? id : roster.agents[0].id;
  }

  function normalizeRosterAndStart(rawSettings) {
    const roster = normalizeRoster(rawSettings);
    return Object.freeze({
      roster,
      startAgentId: normalizeStartAgentId(rawSettings, roster)
    });
  }

  function projectToLegacy(settings) {
    const src = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
    const { roster, startAgentId } = normalizeRosterAndStart(src);
    const out = {
      agentCount: roster.agents.length,
      startSide: caps.legacySideForOrdinal(caps.ordinalForAgentId(startAgentId)) || "A"
    };
    for (let ordinal = 1; ordinal <= MAX_ACTIVE_AGENTS; ordinal += 1) {
      const side = caps.legacySideForOrdinal(ordinal);
      const agent = roster.agents[ordinal - 1] || null;
      out[`label${side}`] = agent?.label ?? `AI ${side}`;
      out[`job${side}`] = agent?.job ?? "";
    }
    return Object.freeze(out);
  }

  function isLegacySide(raw) {
    return caps.ordinalForLegacySide(String(raw || "").toUpperCase()) !== null;
  }

  globalThis[FLAG] = Object.freeze({
    version: VERSION,
    maxActiveAgents: MAX_ACTIVE_AGENTS,
    maxLabelChars: MAX_LABEL_CHARS,
    maxJobChars: MAX_JOB_CHARS,
    normalizeRoster,
    normalizeStartAgentId,
    normalizeRosterAndStart,
    projectToLegacy,
    isLegacySide,
    importsSchemaV1: true,
    emitsSchemaV2Only: true,
    persistsTabBindings: false,
    canonicalRosterAuthority: true
  });
})();
