(() => {
  "use strict";

  // Internal compatibility adapter for roster state.
  //
  // v1.17.1 still persists per-agent fields as tabA/jobA/labelA ... tabE/jobE/labelE.
  // Do not create a second persisted roster representation yet: two writable sources
  // of truth would introduce split-brain state and widen privacy/security review.
  // This adapter gives newer code one audited roster API while legacy persistence
  // remains authoritative until a later migration can be performed atomically.
  const FLAG = "__AI_BRIDGE_ROSTER_STATE_ADAPTER_V1__";
  if (globalThis[FLAG]) return;

  const caps = globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__;
  if (
    !caps ||
    caps.version !== 1 ||
    !Array.isArray(caps.supportedAgentSides) ||
    typeof caps.normalizeAgentCount !== "function"
  ) {
    throw new Error("Roster-state adapter requires the logical-agent capability contract.");
  }

  const ALL_SIDES = Object.freeze(Array.from(caps.supportedAgentSides, side => String(side)));
  const SIDE_SET = new Set(ALL_SIDES);

  function requireState(bridgeState) {
    if (!bridgeState || typeof bridgeState !== "object" || Array.isArray(bridgeState)) {
      throw new TypeError("Roster state must be a bridge-state object.");
    }
    return bridgeState;
  }

  function normalizeSide(rawSide) {
    const side = String(rawSide || "").toUpperCase();
    if (!SIDE_SET.has(side)) {
      throw new RangeError("Unknown logical-agent side.");
    }
    return side;
  }

  function normalizeTabId(raw) {
    if (raw === null || raw === undefined || raw === "") return null;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) return null;
    return value;
  }

  function readAgent(bridgeState, rawSide) {
    const state = requireState(bridgeState);
    const side = normalizeSide(rawSide);
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

    // Explicit field allowlist prevents arbitrary dynamic keys (including
    // __proto__/constructor/prototype) from being projected into bridge state.
    if (Object.prototype.hasOwnProperty.call(input, "tabId")) {
      const tabId = normalizeTabId(input.tabId);
      if (input.tabId != null && input.tabId !== "" && tabId === null) {
        throw new TypeError(`AI ${side} tabId must be a positive integer or null.`);
      }
      state[`tab${side}`] = tabId;
    }
    if (Object.prototype.hasOwnProperty.call(input, "label")) {
      state[`label${side}`] = String(input.label ?? "").slice(0, 240);
    }
    if (Object.prototype.hasOwnProperty.call(input, "job")) {
      state[`job${side}`] = String(input.job ?? "");
    }

    return readAgent(state, side);
  }

  function activeSides(bridgeState, rawCount) {
    const state = requireState(bridgeState);
    const count = caps.normalizeAgentCount(
      rawCount == null ? state.agentCount : rawCount,
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
    for (const side of ALL_SIDES) {
      if (state[`tab${side}`] === undefined) state[`tab${side}`] = null;
      if (state[`label${side}`] === undefined) state[`label${side}`] = `AI ${side}`;
      if (state[`job${side}`] === undefined) state[`job${side}`] = "";
    }
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
    storageAuthority: "legacy-per-side-fields",
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
    AgentRosterStateAdapter
  });
})();