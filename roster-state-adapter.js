(() => {
  "use strict";

  // Audited roster access layer.
  //
  // State V4 makes roster.agents[] the sole persisted roster authority. During
  // the compatibility window, tabA/jobA/labelA ... tabE/jobE/labelE are only
  // ephemeral mirrors for untouched v1.17.1 code and are never persisted.
  const FLAG = "__AI_BRIDGE_ROSTER_STATE_ADAPTER_V1__";
  if (globalThis[FLAG]) return;

  const caps = globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__;
  if (
    !caps ||
    caps.version !== 1 ||
    !Array.isArray(caps.supportedAgentSides) ||
    typeof caps.normalizeAgentCount !== "function" ||
    typeof caps.agentIdForOrdinal !== "function" ||
    typeof caps.ordinalForLegacySide !== "function"
  ) {
    throw new Error("Roster-state adapter requires the logical-agent capability contract.");
  }

  const ALL_SIDES = Object.freeze(Array.from(caps.supportedAgentSides, side => String(side)));
  const SIDE_SET = new Set(ALL_SIDES);
  const MAX_LABEL_CHARS = 240;
  const MAX_JOB_CHARS = 4000;

  function requireState(bridgeState) {
    if (!bridgeState || typeof bridgeState !== "object" || Array.isArray(bridgeState)) {
      throw new TypeError("Roster state must be a bridge-state object.");
    }
    return bridgeState;
  }

  function normalizeSide(rawSide) {
    const side = String(rawSide || "").toUpperCase();
    if (!SIDE_SET.has(side)) throw new RangeError("Unknown logical-agent side.");
    return side;
  }

  function normalizeTabId(raw) {
    if (raw === null || raw === undefined || raw === "") return null;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) return null;
    return value;
  }

  function normalizeLabel(raw, side) {
    return String(raw ?? `AI ${side}`).slice(0, MAX_LABEL_CHARS);
  }

  function normalizeJob(raw) {
    return String(raw ?? "").trim().slice(0, MAX_JOB_CHARS);
  }

  function isRosterV2State(state) {
    return Number(state?.stateVersion) === 4 &&
      Number(state?.roster?.version) === 2 &&
      Array.isArray(state?.roster?.agents);
  }

  function rosterAgentBySide(state, side) {
    if (!isRosterV2State(state)) return null;
    const ordinal = caps.ordinalForLegacySide(side);
    if (ordinal === null) return null;
    const id = caps.agentIdForOrdinal(ordinal);
    return state.roster.agents.find(agent =>
      agent &&
      String(agent.id || "") === id &&
      Number(agent.ordinal) === ordinal &&
      String(agent.legacySide || "") === side
    ) || null;
  }

  function replaceRosterAgents(state, agents) {
    const normalized = agents.map((agent, index) => {
      const ordinal = index + 1;
      const side = caps.legacySideForOrdinal(ordinal);
      if (!side) throw new RangeError("Current compatibility runtime cannot represent this roster ordinal.");
      return Object.freeze({
        id: caps.agentIdForOrdinal(ordinal),
        ordinal,
        legacySide: side,
        label: normalizeLabel(agent?.label, side),
        job: normalizeJob(agent?.job),
        tabId: normalizeTabId(agent?.tabId)
      });
    });

    const seenTabs = new Set();
    for (const agent of normalized) {
      if (agent.tabId === null) continue;
      if (seenTabs.has(agent.tabId)) throw new Error("Each logical agent must use a different browser tab.");
      seenTabs.add(agent.tabId);
    }

    state.roster = Object.freeze({
      version: 2,
      nextOrdinal: normalized.length + 1,
      agents: Object.freeze(normalized)
    });
    state.agentCount = normalized.length;
    syncLegacyProjection(state);
    return state.roster;
  }

  function syncLegacyProjection(state) {
    for (const side of ALL_SIDES) {
      const agent = rosterAgentBySide(state, side);
      state[`tab${side}`] = agent?.tabId ?? null;
      state[`label${side}`] = agent?.label ?? `AI ${side}`;
      state[`job${side}`] = agent?.job ?? "";
    }
    return state;
  }

  function readAgent(bridgeState, rawSide) {
    const state = requireState(bridgeState);
    const side = normalizeSide(rawSide);
    const rosterAgent = rosterAgentBySide(state, side);
    if (rosterAgent) {
      return Object.freeze({
        side,
        id: rosterAgent.id,
        ordinal: rosterAgent.ordinal,
        tabId: normalizeTabId(rosterAgent.tabId),
        label: normalizeLabel(rosterAgent.label, side),
        job: normalizeJob(rosterAgent.job)
      });
    }

    return Object.freeze({
      side,
      tabId: normalizeTabId(state[`tab${side}`]),
      label: String(state[`label${side}`] ?? `AI ${side}`),
      job: String(state[`job${side}`] ?? "")
    });
  }

  function writeAgent(bridgeState, rawSide, patch) {
    const state = requireState(bridgeState);
    const side = normalizeSide(rawSide);
    const input = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};

    if (isRosterV2State(state)) {
      const ordinal = caps.ordinalForLegacySide(side);
      const index = ordinal === null ? -1 : ordinal - 1;
      if (index < 0 || index >= state.roster.agents.length) {
        throw new RangeError("Cannot write an inactive logical agent in the V4 roster.");
      }

      const current = state.roster.agents[index];
      const next = {
        ...current,
        ...(Object.prototype.hasOwnProperty.call(input, "tabId") ? { tabId: normalizeTabId(input.tabId) } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, "label") ? { label: normalizeLabel(input.label, side) } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, "job") ? { job: normalizeJob(input.job) } : {})
      };
      if (
        Object.prototype.hasOwnProperty.call(input, "tabId") &&
        input.tabId != null &&
        input.tabId !== "" &&
        next.tabId === null
      ) {
        throw new TypeError(`AI ${side} tabId must be a positive integer or null.`);
      }

      const agents = state.roster.agents.map((agent, i) => i === index ? next : agent);
      replaceRosterAgents(state, agents);
      return readAgent(state, side);
    }

    // State V3 compatibility path. This exists only for the one-way migration
    // window and never creates a second persisted V4 roster.
    if (Object.prototype.hasOwnProperty.call(input, "tabId")) {
      const tabId = normalizeTabId(input.tabId);
      if (input.tabId != null && input.tabId !== "" && tabId === null) {
        throw new TypeError(`AI ${side} tabId must be a positive integer or null.`);
      }
      state[`tab${side}`] = tabId;
    }
    if (Object.prototype.hasOwnProperty.call(input, "label")) {
      state[`label${side}`] = normalizeLabel(input.label, side);
    }
    if (Object.prototype.hasOwnProperty.call(input, "job")) {
      state[`job${side}`] = normalizeJob(input.job);
    }

    return readAgent(state, side);
  }

  function activeSides(bridgeState, rawCount) {
    const state = requireState(bridgeState);
    const authoritativeCount = isRosterV2State(state) ? state.roster.agents.length : state.agentCount;
    const count = caps.normalizeAgentCount(
      rawCount == null ? authoritativeCount : rawCount,
      caps.defaultAgentCount
    );
    return Object.freeze(Array.from(caps.sideIdsForCount(count)));
  }

  function snapshot(bridgeState, rawCount) {
    const state = requireState(bridgeState);
    return Object.freeze(activeSides(state, rawCount).map(side => readAgent(state, side)));
  }

  function ensureLegacyFields(bridgeState) {
    const state = requireState(bridgeState);
    if (isRosterV2State(state)) return syncLegacyProjection(state);
    for (const side of ALL_SIDES) {
      if (state[`tab${side}`] === undefined) state[`tab${side}`] = null;
      if (state[`label${side}`] === undefined) state[`label${side}`] = `AI ${side}`;
      if (state[`job${side}`] === undefined) state[`job${side}`] = "";
    }
    return state;
  }

  function setAgentCount(bridgeState, rawCount) {
    const state = requireState(bridgeState);
    const count = caps.parseAgentCount(rawCount);
    if (count === null) {
      throw new RangeError(`Agent count must be an integer from 1 to ${caps.maxLogicalAgents}.`);
    }
    if (!isRosterV2State(state)) {
      state.agentCount = count;
      ensureLegacyFields(state);
      return state;
    }

    const agents = [];
    for (let ordinal = 1; ordinal <= count; ordinal += 1) {
      const side = caps.legacySideForOrdinal(ordinal);
      const existing = state.roster.agents[ordinal - 1];
      agents.push(existing || {
        id: caps.agentIdForOrdinal(ordinal),
        ordinal,
        legacySide: side,
        label: state[`label${side}`] ?? `AI ${side}`,
        job: state[`job${side}`] ?? "",
        tabId: state[`tab${side}`] ?? null
      });
    }
    replaceRosterAgents(state, agents);
    return state;
  }

  class AgentRosterStateAdapter {
    constructor(bridgeState) {
      this.state = requireState(bridgeState);
    }

    sides(rawCount) {
      return activeSides(this.state, rawCount);
    }

    get(side) {
      return readAgent(this.state, side);
    }

    set(side, patch) {
      return writeAgent(this.state, side, patch);
    }

    setCount(rawCount) {
      setAgentCount(this.state, rawCount);
      return this;
    }

    snapshot(rawCount) {
      return snapshot(this.state, rawCount);
    }

    ensureLegacyFields() {
      ensureLegacyFields(this.state);
      return this;
    }
  }

  globalThis.AgentRosterStateAdapter = AgentRosterStateAdapter;
  globalThis[FLAG] = Object.freeze({
    version: 1,
    storageAuthority: "roster-v2",
    legacyProjectionEphemeral: true,
    runtimeWritesRosterV2: true,
    persistsSecondRosterRepresentation: false,
    validatesSideKeys: true,
    writeFieldAllowlist: Object.freeze(["tabId", "label", "job"]),
    allSides: ALL_SIDES,
    normalizeSide,
    readAgent,
    writeAgent,
    activeSides,
    snapshot,
    ensureLegacyFields,
    setAgentCount,
    AgentRosterStateAdapter
  });
})();