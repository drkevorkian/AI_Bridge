(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_ROSTER_V2_MIGRATION_V1__";
  if (globalThis[FLAG]) return;

  const caps = globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__;
  if (
    !caps ||
    caps.version !== 1 ||
    typeof caps.agentIdForOrdinal !== "function" ||
    typeof caps.legacySideForOrdinal !== "function" ||
    typeof caps.parseAgentCount !== "function"
  ) {
    throw new Error("Roster V2 migration requires the logical-agent capability contract.");
  }

  const SOURCE_STATE_VERSION = 3;
  const TARGET_STATE_VERSION = 4;
  const ROSTER_VERSION = 2;
  const MAX_LABEL_CHARS = 240;
  const MAX_JOB_CHARS = 4000;

  function requireLegacyState(rawState) {
    if (!rawState || typeof rawState !== "object" || Array.isArray(rawState)) {
      throw new TypeError("Legacy bridge state must be an object.");
    }
    if (
      rawState.stateVersion !== undefined &&
      Number(rawState.stateVersion) !== SOURCE_STATE_VERSION
    ) {
      throw new RangeError(`Roster V2 migration requires stateVersion ${SOURCE_STATE_VERSION}.`);
    }
    return rawState;
  }

  function legacyAgentCount(state) {
    if (state.agentCount === undefined || state.agentCount === null || state.agentCount === "") {
      return caps.defaultAgentCount;
    }
    const count = caps.parseAgentCount(state.agentCount);
    if (count === null) {
      throw new RangeError(
        `Legacy agentCount must be an integer from 1 to ${caps.maxLogicalAgents}.`
      );
    }
    return count;
  }

  function normalizeLegacyTabId(raw, side) {
    if (raw === undefined || raw === null || raw === "") return null;
    const tabId = Number(raw);
    if (!Number.isInteger(tabId) || tabId <= 0) {
      throw new TypeError(`AI ${side} has an invalid legacy tab binding.`);
    }
    return tabId;
  }

  function normalizeLabel(raw, side) {
    return String(raw ?? `AI ${side}`).slice(0, MAX_LABEL_CHARS);
  }

  function normalizeJob(raw) {
    return String(raw ?? "").trim().slice(0, MAX_JOB_CHARS);
  }

  function freezeAgent(agent) {
    return Object.freeze(agent);
  }

  function buildRosterV2FromLegacyState(rawState) {
    const state = requireLegacyState(rawState);
    const count = legacyAgentCount(state);
    const agents = [];
    const seenTabIds = new Set();

    for (let ordinal = 1; ordinal <= count; ordinal += 1) {
      const legacySide = caps.legacySideForOrdinal(ordinal);
      if (!legacySide) {
        throw new RangeError(
          `Legacy state cannot map ordinal ${ordinal} to an A-E compatibility side.`
        );
      }

      const tabId = normalizeLegacyTabId(state[`tab${legacySide}`], legacySide);
      if (tabId !== null) {
        if (seenTabIds.has(tabId)) {
          throw new Error(`Legacy roster contains duplicate browser tab binding ${tabId}.`);
        }
        seenTabIds.add(tabId);
      }

      agents.push(freezeAgent({
        id: caps.agentIdForOrdinal(ordinal),
        ordinal,
        legacySide,
        label: normalizeLabel(state[`label${legacySide}`], legacySide),
        job: normalizeJob(state[`job${legacySide}`]),
        tabId
      }));
    }

    return Object.freeze({
      stateVersion: TARGET_STATE_VERSION,
      roster: Object.freeze({
        version: ROSTER_VERSION,
        nextOrdinal: count + 1,
        agents: Object.freeze(agents)
      })
    });
  }

  function validateRosterV2(rawRoster) {
    if (!rawRoster || typeof rawRoster !== "object" || Array.isArray(rawRoster)) {
      throw new TypeError("Roster V2 must be an object.");
    }
    if (Number(rawRoster.version) !== ROSTER_VERSION) {
      throw new RangeError(`Roster version must be ${ROSTER_VERSION}.`);
    }
    if (!Array.isArray(rawRoster.agents)) {
      throw new TypeError("Roster V2 agents must be an array.");
    }

    const seenIds = new Set();
    const seenOrdinals = new Set();
    const seenTabIds = new Set();

    for (const rawAgent of rawRoster.agents) {
      if (!rawAgent || typeof rawAgent !== "object" || Array.isArray(rawAgent)) {
        throw new TypeError("Every roster agent must be an object.");
      }
      const id = String(rawAgent.id || "");
      const ordinal = caps.ordinalForAgentId(id);
      if (ordinal === null || Number(rawAgent.ordinal) !== ordinal) {
        throw new TypeError("Roster agent ID and ordinal must be canonical and consistent.");
      }
      if (seenIds.has(id) || seenOrdinals.has(ordinal)) {
        throw new Error("Roster V2 contains duplicate agent identity.");
      }
      seenIds.add(id);
      seenOrdinals.add(ordinal);

      const tabId = normalizeLegacyTabId(rawAgent.tabId, id);
      if (tabId !== null) {
        if (seenTabIds.has(tabId)) {
          throw new Error(`Roster V2 contains duplicate browser tab binding ${tabId}.`);
        }
        seenTabIds.add(tabId);
      }
    }

    return true;
  }

  globalThis[FLAG] = Object.freeze({
    version: 1,
    sourceStateVersion: SOURCE_STATE_VERSION,
    targetStateVersion: TARGET_STATE_VERSION,
    rosterVersion: ROSTER_VERSION,
    maxLabelChars: MAX_LABEL_CHARS,
    maxJobChars: MAX_JOB_CHARS,
    buildRosterV2FromLegacyState,
    validateRosterV2,
    noPersistenceSideEffects: true
  });
})();
