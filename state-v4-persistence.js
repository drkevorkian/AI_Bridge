(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_STATE_V4_PERSISTENCE_V1__";
  if (globalThis[FLAG]) return;

  const caps = globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__;
  const rosterMigration = globalThis.__AI_BRIDGE_ROSTER_V2_MIGRATION_V1__;
  if (
    !caps ||
    caps.version !== 1 ||
    !rosterMigration ||
    rosterMigration.version !== 1 ||
    typeof rosterMigration.buildRosterV2FromLegacyState !== "function" ||
    typeof rosterMigration.validateRosterV2 !== "function"
  ) {
    throw new Error("State V4 persistence requires agent capabilities and the Roster V2 migrator.");
  }

  const SOURCE_STATE_VERSION = 3;
  const TARGET_STATE_VERSION = 4;
  const ROSTER_VERSION = 2;

  const SCALAR_FIELDS = Object.freeze([
    "sessionActive", "running", "paused", "pauseReason",
    "teamRules",
    "pendingMainInterjections", "workMode", "workPhase",
    "pendingHumanQueue", "suppressedHumanRequests",
    "turn", "maxTurns", "cycleCount", "maxCycles",
    "checkpointEveryNCycles", "stuckTimeoutMinutes",
    "recoveryCheckpoint", "checkpointPending", "checkpointRequestId", "postCheckpointResume",
    "delayMs", "initialPrompt", "sourceFiles",
    "relayArtifacts", "activeArtifactIds",
    "awaitingHuman", "pendingHuman",
    "transcript", "nextSeq", "log"
  ]);

  const SINGLE_AGENT_REF_FIELDS = Object.freeze(["currentSide", "startSide", "mainSide"]);
  const AGENT_REF_LIST_FIELDS = Object.freeze([
    "activeSides", "cycleParticipants", "phasePendingSides", "phaseSentSides", "phaseCompletedSides"
  ]);
  const AGENT_MAP_FIELDS = Object.freeze([
    "sourceDeliveredBySide",
    "lastSentArtifactIdsBySide",
    "lastResponseBySide",
    "lastSentBySide",
    "lastDeliveredSeqBySide",
    "roundStartedAtBySide",
    "roundNumberBySide",
    "lastRoundDurationMsBySide",
    "lastRoundCompletedAtBySide",
    "totalWorkMsBySide",
    "generationIdBySide",
    "recoveryAttemptBySide",
    "lastProgressAtBySide",
    "primaryResponseSeqBySide",
    "reviewResponseSeqBySide",
    "viewpointIdentityBySide"
  ]);

  const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

  function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    // Object.prototype identity is realm-specific (e.g. Node VM tests and
    // extension worlds). The intrinsic tag safely recognizes ordinary record
    // objects across realms; cloneData still rejects prototype-pollution keys.
    return Object.prototype.toString.call(value) === "[object Object]";
  }

  function cloneData(value, path = "value") {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;

    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number.`);
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item, index) => cloneData(item, `${path}[${index}]`));
    }

    if (isPlainObject(value)) {
      const out = {};
      for (const key of Object.keys(value)) {
        if (FORBIDDEN_KEYS.has(key)) {
          throw new TypeError(`${path} contains a forbidden object key.`);
        }
        out[key] = cloneData(value[key], `${path}.${key}`);
      }
      return out;
    }

    if (value === undefined) return undefined;
    throw new TypeError(`${path} contains unsupported persisted data.`);
  }

  function legacyRosterInput(runtimeState) {
    const out = { stateVersion: SOURCE_STATE_VERSION, agentCount: runtimeState?.agentCount };
    for (const side of caps.supportedAgentSides) {
      out[`tab${side}`] = runtimeState?.[`tab${side}`] ?? null;
      out[`label${side}`] = runtimeState?.[`label${side}`] ?? `AI ${side}`;
      out[`job${side}`] = runtimeState?.[`job${side}`] ?? "";
    }
    return out;
  }

  function sanitizeRoster(rawRoster) {
    rosterMigration.validateRosterV2(rawRoster);

    const rawAgents = rawRoster.agents;
    if (rawAgents.length < 1 || rawAgents.length > caps.maxLogicalAgents) {
      throw new RangeError(`Roster V2 must contain 1 to ${caps.maxLogicalAgents} active agents in this release.`);
    }

    const agents = [];
    for (let index = 0; index < rawAgents.length; index += 1) {
      const raw = rawAgents[index];
      const expectedOrdinal = index + 1;
      const id = caps.agentIdForOrdinal(expectedOrdinal);
      if (String(raw.id || "") !== id || Number(raw.ordinal) !== expectedOrdinal) {
        throw new Error("Roster V2 agents must be contiguous and ordered by canonical ordinal.");
      }
      const expectedLegacySide = caps.legacySideForOrdinal(expectedOrdinal);
      const rawLegacySide = raw.legacySide == null ? null : String(raw.legacySide);
      if (rawLegacySide !== expectedLegacySide) {
        throw new Error("Roster V2 legacy compatibility aliases must match canonical ordinals.");
      }

      const tabId = raw.tabId === null || raw.tabId === undefined || raw.tabId === ""
        ? null
        : Number(raw.tabId);
      if (tabId !== null && (!Number.isInteger(tabId) || tabId <= 0)) {
        throw new TypeError(`Roster agent ${id} has an invalid tab binding.`);
      }

      agents.push(Object.freeze({
        id,
        ordinal: expectedOrdinal,
        legacySide: expectedLegacySide,
        label: String(raw.label ?? `AI ${runtimeKeyForOrdinal(expectedOrdinal)}`).slice(0, rosterMigration.maxLabelChars),
        job: String(raw.job ?? "").trim().slice(0, rosterMigration.maxJobChars),
        tabId
      }));
    }

    const expectedNextOrdinal = agents.length + 1;
    if (Number(rawRoster.nextOrdinal) !== expectedNextOrdinal) {
      throw new Error("Roster V2 nextOrdinal must follow the active contiguous roster.");
    }

    const sanitized = Object.freeze({
      version: ROSTER_VERSION,
      nextOrdinal: expectedNextOrdinal,
      agents: Object.freeze(agents)
    });
    rosterMigration.validateRosterV2(sanitized);
    return sanitized;
  }

  function normalizedRosterFromRuntime(runtimeState) {
    if (runtimeState?.stateVersion === TARGET_STATE_VERSION && runtimeState?.roster) {
      return sanitizeRoster(runtimeState.roster);
    }
    return sanitizeRoster(rosterMigration.buildRosterV2FromLegacyState(legacyRosterInput(runtimeState)).roster);
  }

  function runtimeKeyForOrdinal(ordinal) {
    if (typeof caps.runtimeAgentKeyForOrdinal === "function") {
      return caps.runtimeAgentKeyForOrdinal(ordinal);
    }
    return caps.legacySideForOrdinal(ordinal) || caps.agentIdForOrdinal(ordinal);
  }

  function ordinalForRuntimeKey(rawKey) {
    if (typeof caps.ordinalForRuntimeAgentKey === "function") {
      return caps.ordinalForRuntimeAgentKey(rawKey);
    }
    const legacyOrdinal = caps.ordinalForLegacySide(rawKey);
    if (legacyOrdinal !== null) return legacyOrdinal;
    return caps.ordinalForAgentId(rawKey);
  }

  function canonicalIdForRuntimeRef(rawRef, roster, { allowNull = true } = {}) {
    if (rawRef === null || rawRef === undefined || rawRef === "") {
      if (allowNull) return null;
      throw new Error("Logical-agent reference is required.");
    }
    const ordinal = ordinalForRuntimeKey(String(rawRef));
    if (ordinal === null) throw new Error("Persisted runtime contains an unknown logical-agent reference.");
    const id = caps.agentIdForOrdinal(ordinal);
    if (!roster.agents.some(agent => agent.id === id)) {
      throw new Error("Persisted runtime references an agent outside the active roster.");
    }
    return id;
  }

  function runtimeRefForCanonicalId(rawId, roster, { allowNull = true } = {}) {
    if (rawId === null || rawId === undefined || rawId === "") {
      if (allowNull) return null;
      throw new Error("Canonical logical-agent reference is required.");
    }
    const id = String(rawId);
    const ordinal = caps.ordinalForAgentId(id);
    if (ordinal === null) throw new Error("Persisted state contains a malformed canonical agent ID.");
    const agent = roster.agents.find(row => row.id === id);
    if (!agent) throw new Error("Persisted state references an agent outside the active roster.");
    return runtimeKeyForOrdinal(ordinal);
  }

  function canonicalizeRefList(raw, roster) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const item of raw) {
      const id = canonicalIdForRuntimeRef(item, roster, { allowNull: false });
      if (!out.includes(id)) out.push(id);
    }
    return out;
  }

  function hydrateRefList(raw, roster) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const item of raw) {
      const side = runtimeRefForCanonicalId(item, roster, { allowNull: false });
      if (!out.includes(side)) out.push(side);
    }
    return out;
  }

  function canonicalizeSideMap(raw, roster, fieldName) {
    const source = isPlainObject(raw) ? raw : {};
    const out = {};
    for (const agent of roster.agents) {
      const runtimeKey = runtimeKeyForOrdinal(agent.ordinal);
      if (!Object.prototype.hasOwnProperty.call(source, runtimeKey)) continue;
      const cloned = cloneData(source[runtimeKey], `${fieldName}.${runtimeKey}`);
      if (cloned !== undefined) out[agent.id] = cloned;
    }
    return out;
  }

  function hydrateSideMap(raw, roster, fieldName) {
    if (raw === undefined || raw === null) return {};
    if (!isPlainObject(raw)) throw new TypeError(`${fieldName} must be an object keyed by canonical agent ID.`);
    const out = {};
    for (const [id, value] of Object.entries(raw)) {
      if (FORBIDDEN_KEYS.has(id)) throw new TypeError(`${fieldName} contains a forbidden key.`);
      const side = runtimeRefForCanonicalId(id, roster, { allowNull: false });
      out[side] = cloneData(value, `${fieldName}.${id}`);
    }
    return out;
  }

  function serializeRuntimeState(runtimeState) {
    if (!runtimeState || typeof runtimeState !== "object" || Array.isArray(runtimeState)) {
      throw new TypeError("Runtime bridge state must be an object.");
    }

    const roster = normalizedRosterFromRuntime(runtimeState);
    const out = { stateVersion: TARGET_STATE_VERSION, roster };

    for (const field of SCALAR_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(runtimeState, field)) continue;
      const cloned = cloneData(runtimeState[field], field);
      if (cloned !== undefined) out[field] = cloned;
    }

    for (const field of SINGLE_AGENT_REF_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(runtimeState, field)) continue;
      out[field] = canonicalIdForRuntimeRef(runtimeState[field], roster, { allowNull: true });
    }

    for (const field of AGENT_REF_LIST_FIELDS) {
      out[field] = canonicalizeRefList(runtimeState[field], roster);
    }

    for (const field of AGENT_MAP_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(runtimeState, field)) continue;
      out[field] = canonicalizeSideMap(runtimeState[field], roster, field);
    }

    return out;
  }

  function hydratePersistedState(rawState) {
    if (!rawState || typeof rawState !== "object" || Array.isArray(rawState)) {
      throw new TypeError("Persisted V4 bridge state must be an object.");
    }
    if (Number(rawState.stateVersion) !== TARGET_STATE_VERSION) {
      throw new RangeError(`Persisted bridge state must use stateVersion ${TARGET_STATE_VERSION}.`);
    }

    const roster = sanitizeRoster(rawState.roster);
    const out = { stateVersion: TARGET_STATE_VERSION, roster, agentCount: roster.agents.length };

    for (const field of SCALAR_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(rawState, field)) continue;
      const cloned = cloneData(rawState[field], field);
      if (cloned !== undefined) out[field] = cloned;
    }

    for (const field of SINGLE_AGENT_REF_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(rawState, field)) continue;
      out[field] = runtimeRefForCanonicalId(rawState[field], roster, { allowNull: true });
    }

    for (const field of AGENT_REF_LIST_FIELDS) {
      out[field] = hydrateRefList(rawState[field], roster);
    }

    for (const field of AGENT_MAP_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(rawState, field)) continue;
      out[field] = hydrateSideMap(rawState[field], roster, field);
    }

    const bySide = new Map(
      roster.agents
        .filter(agent => agent.legacySide)
        .map(agent => [agent.legacySide, agent])
    );
    for (const side of caps.supportedAgentSides) {
      const agent = bySide.get(side);
      out[`tab${side}`] = agent?.tabId ?? null;
      out[`label${side}`] = agent?.label ?? `AI ${side}`;
      out[`job${side}`] = agent?.job ?? "";
    }

    return out;
  }

  function migrateV3State(rawState) {
    if (!rawState || typeof rawState !== "object" || Array.isArray(rawState)) {
      throw new TypeError("Persisted V3 bridge state must be an object.");
    }
    if (Number(rawState.stateVersion) !== SOURCE_STATE_VERSION) {
      throw new RangeError(`State migration requires stateVersion ${SOURCE_STATE_VERSION}.`);
    }
    return serializeRuntimeState(rawState);
  }

  function sanitizeV4State(rawState) {
    return serializeRuntimeState(hydratePersistedState(rawState));
  }

  globalThis[FLAG] = Object.freeze({
    version: 1,
    sourceStateVersion: SOURCE_STATE_VERSION,
    targetStateVersion: TARGET_STATE_VERSION,
    rosterVersion: ROSTER_VERSION,
    scalarFields: SCALAR_FIELDS,
    singleAgentRefFields: SINGLE_AGENT_REF_FIELDS,
    agentRefListFields: AGENT_REF_LIST_FIELDS,
    agentMapFields: AGENT_MAP_FIELDS,
    serializeRuntimeState,
    hydratePersistedState,
    migrateV3State,
    sanitizeV4State,
    legacyProjectionIsEphemeral: true,
    persistsLegacyRosterFields: false,
    canonicalizesAgentReferences: true,
    canonicalizesExecutionMaps: true,
    runtimeAgentReferencesDecoupledFromLegacyAliases: true,
    noStorageSideEffects: true
  });
})();
