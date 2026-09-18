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

  function runtimeKeyForOrdinal(ordinal) {
    if (typeof caps.runtimeAgentKeyForOrdinal === "function") {
      return caps.runtimeAgentKeyForOrdinal(ordinal);
    }
    return caps.legacySideForOrdinal(ordinal) || caps.agentIdForOrdinal(ordinal);
  }

  function ordinalForAgentRef(rawRef) {
    if (typeof rawRef !== "string") return null;
    if (typeof caps.ordinalForRuntimeAgentKey === "function") {
      return caps.ordinalForRuntimeAgentKey(rawRef);
    }
    const legacyOrdinal = caps.ordinalForLegacySide(rawRef);
    if (legacyOrdinal !== null) return legacyOrdinal;
    if (typeof caps.ordinalForAgentId === "function") return caps.ordinalForAgentId(rawRef);
    const match = /^agent-([1-9][0-9]*)$/.exec(rawRef);
    if (!match) return null;
    const ordinal = Number(match[1]);
    return Number.isSafeInteger(ordinal) && ordinal >= 1 ? ordinal : null;
  }

  function normalizeAgentRef(rawRef) {
    const ordinal = ordinalForAgentRef(String(rawRef || ""));
    if (ordinal === null) throw new RangeError("Unknown logical-agent reference.");
    return runtimeKeyForOrdinal(ordinal);
  }

  function normalizeSide(rawSide) {
    const ref = normalizeAgentRef(rawSide);
    if (!SIDE_SET.has(ref)) throw new RangeError("Unknown logical-agent side.");
    return ref;
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

  function rosterAgentByRef(state, rawRef) {
    if (!isRosterV2State(state)) return null;
    const ordinal = ordinalForAgentRef(String(rawRef || ""));
    if (ordinal === null) return null;
    const id = caps.agentIdForOrdinal(ordinal);
    return state.roster.agents.find(agent =>
      agent &&
      String(agent.id || "") === id &&
      Number(agent.ordinal) === ordinal
    ) || null;
  }

  function replaceRosterAgents(state, agents) {
    const normalized = agents.map((agent, index) => {
      const ordinal = index + 1;
      const side = caps.legacySideForOrdinal(ordinal);
      const runtimeKey = runtimeKeyForOrdinal(ordinal);
      return Object.freeze({
        id: caps.agentIdForOrdinal(ordinal),
        ordinal,
        legacySide: side,
        label: normalizeLabel(agent?.label, runtimeKey),
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
      const agent = rosterAgentByRef(state, side);
      state[`tab${side}`] = agent?.tabId ?? null;
      state[`label${side}`] = agent?.label ?? `AI ${side}`;
      state[`job${side}`] = agent?.job ?? "";
    }
    return state;
  }

  function readAgent(bridgeState, rawRef) {
    const state = requireState(bridgeState);
    const runtimeKey = normalizeAgentRef(rawRef);
    const ordinal = ordinalForAgentRef(runtimeKey);
    const rosterAgent = rosterAgentByRef(state, runtimeKey);
    if (rosterAgent) {
      return Object.freeze({
        side: runtimeKey,
        runtimeKey,
        id: rosterAgent.id,
        ordinal: rosterAgent.ordinal,
        tabId: normalizeTabId(rosterAgent.tabId),
        label: normalizeLabel(rosterAgent.label, runtimeKey),
        job: normalizeJob(rosterAgent.job)
      });
    }

    const legacySide = caps.legacySideForOrdinal(ordinal);
    if (!legacySide) {
      throw new RangeError("Canonical F+ agent is inactive in the current roster.");
    }
    return Object.freeze({
      side: legacySide,
      runtimeKey: legacySide,
      tabId: normalizeTabId(state[`tab${legacySide}`]),
      label: String(state[`label${legacySide}`] ?? `AI ${legacySide}`),
      job: String(state[`job${legacySide}`] ?? "")
    });
  }

  function writeAgent(bridgeState, rawRef, patch) {
    const state = requireState(bridgeState);
    const runtimeKey = normalizeAgentRef(rawRef);
    const ordinal = ordinalForAgentRef(runtimeKey);
    const side = caps.legacySideForOrdinal(ordinal);
    const input = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};

    if (isRosterV2State(state)) {
      const index = ordinal === null ? -1 : ordinal - 1;
      if (index < 0 || index >= state.roster.agents.length) {
        throw new RangeError("Cannot write an inactive logical agent in the V4 roster.");
      }

      const current = state.roster.agents[index];
      const next = {
        ...current,
        ...(Object.prototype.hasOwnProperty.call(input, "tabId") ? { tabId: normalizeTabId(input.tabId) } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, "label") ? { label: normalizeLabel(input.label, runtimeKey) } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, "job") ? { job: normalizeJob(input.job) } : {})
      };
      if (
        Object.prototype.hasOwnProperty.call(input, "tabId") &&
        input.tabId != null &&
        input.tabId !== "" &&
        next.tabId === null
      ) {
        throw new TypeError(`AI ${runtimeKey} tabId must be a positive integer or null.`);
      }

      const agents = state.roster.agents.map((agent, i) => i === index ? next : agent);
      replaceRosterAgents(state, agents);
      return readAgent(state, runtimeKey);
    }

    // State V3 compatibility path only has A-E fields.
    if (!side) throw new RangeError("Canonical F+ agents require State V4 roster authority.");
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

    return readAgent(state, runtimeKey);
  }

  function activeSides(bridgeState, rawCount) {
    const state = requireState(bridgeState);
    const authoritativeCount = isRosterV2State(state) ? state.roster.agents.length : state.agentCount;
    const count = caps.normalizeAgentCount(
      rawCount == null ? authoritativeCount : rawCount,
      caps.defaultAgentCount
    );
    return Object.freeze(
      Array.from({ length: count }, (_, index) => runtimeKeyForOrdinal(index + 1))
    );
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
      const runtimeKey = runtimeKeyForOrdinal(ordinal);
      const existing = state.roster.agents[ordinal - 1];
      agents.push(existing || {
        id: caps.agentIdForOrdinal(ordinal),
        ordinal,
        legacySide: side,
        label: side ? (state[`label${side}`] ?? `AI ${side}`) : `AI ${runtimeKey}`,
        job: side ? (state[`job${side}`] ?? "") : "",
        tabId: side ? (state[`tab${side}`] ?? null) : null
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
    runtimeAgentReferences: true,
    writeFieldAllowlist: Object.freeze(["tabId", "label", "job"]),
    allSides: ALL_SIDES,
    normalizeSide,
    normalizeAgentRef,
    readAgent,
    writeAgent,
    activeSides,
    snapshot,
    ensureLegacyFields,
    setAgentCount,
    AgentRosterStateAdapter
  });
})();