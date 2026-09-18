(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_EXECUTION_KEY_ADAPTER_V1__";
  if (globalThis[FLAG]) return;

  const caps = globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__;
  if (
    !caps ||
    caps.version !== 1 ||
    typeof caps.ordinalForAgentId !== "function" ||
    typeof caps.ordinalForLegacySide !== "function" ||
    typeof caps.legacySideForOrdinal !== "function" ||
    typeof caps.agentIdForOrdinal !== "function"
  ) {
    throw new Error("Execution-key adapter requires the logical-agent capability contract.");
  }

  function runtimeKeyForOrdinal(ordinal) {
    if (typeof caps.runtimeAgentKeyForOrdinal === "function") {
      return runtimeKeyForOrdinal(ordinal);
    }
    return caps.legacySideForOrdinal(ordinal) || caps.agentIdForOrdinal(ordinal);
  }

  function ordinalForRuntimeKey(rawKey) {
    if (typeof caps.ordinalForRuntimeAgentKey === "function") {
      return ordinalForRuntimeKey(rawKey);
    }
    const legacyOrdinal = caps.ordinalForLegacySide(rawKey);
    if (legacyOrdinal !== null) return legacyOrdinal;
    return caps.ordinalForAgentId(rawKey);
  }

  const ALLOWED_MAPS = Object.freeze(new Set([
    "generationIdBySide",
    "viewpointIdentityBySide",
    "recoveryAttemptBySide",
    "lastProgressAtBySide",
    "lastDeliveredSeqBySide",
    "roundStartedAtBySide",
    "roundNumberBySide",
    "lastRoundDurationMsBySide",
    "lastRoundCompletedAtBySide",
    "sourceDeliveredBySide",
    "primaryResponseSeqBySide",
    "reviewResponseSeqBySide",
    "lastResponseBySide",
    "lastSentBySide"
  ]));

  function requireMapName(rawName) {
    const name = String(rawName || "");
    if (!ALLOWED_MAPS.has(name)) {
      throw new RangeError("Unknown execution-state map.");
    }
    return name;
  }

  function executionKeyForAgentRef(rawRef) {
    if (typeof rawRef !== "string") {
      throw new TypeError("Logical-agent reference must be a string.");
    }

    const canonicalOrdinal = caps.ordinalForAgentId(rawRef);
    if (canonicalOrdinal !== null) {
      return runtimeKeyForOrdinal(canonicalOrdinal);
    }

    const legacyOrdinal = caps.ordinalForLegacySide(rawRef);
    if (legacyOrdinal !== null) return runtimeKeyForOrdinal(legacyOrdinal);

    throw new RangeError("Unknown logical-agent reference.");
  }

  function canonicalAgentIdForExecutionKey(rawKey) {
    const ordinal = ordinalForRuntimeKey(rawKey);
    if (ordinal === null) throw new RangeError("Unknown execution-state key.");
    return caps.agentIdForOrdinal(ordinal);
  }

  function ensureMap(state, mapName) {
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      throw new TypeError("Execution state must be an object.");
    }
    const name = requireMapName(mapName);
    const current = state[name];
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      state[name] = {};
    }
    return state[name];
  }

  function read(state, mapName, agentRef, fallback = undefined) {
    const map = ensureMap(state, mapName);
    const key = executionKeyForAgentRef(agentRef);
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback;
  }

  function write(state, mapName, agentRef, value) {
    const map = ensureMap(state, mapName);
    const key = executionKeyForAgentRef(agentRef);
    map[key] = value;
    return value;
  }

  function remove(state, mapName, agentRef) {
    const map = ensureMap(state, mapName);
    const key = executionKeyForAgentRef(agentRef);
    const had = Object.prototype.hasOwnProperty.call(map, key);
    if (had) delete map[key];
    return had;
  }

  function has(state, mapName, agentRef) {
    const map = ensureMap(state, mapName);
    const key = executionKeyForAgentRef(agentRef);
    return Object.prototype.hasOwnProperty.call(map, key);
  }

  globalThis[FLAG] = Object.freeze({
    version: 1,
    executionKeyForAgentRef,
    canonicalAgentIdForExecutionKey,
    read,
    write,
    remove,
    has,
    allowedMaps: Object.freeze(Array.from(ALLOWED_MAPS)),
    persistsSecondExecutionMapRepresentation: false,
    legacyExecutionKeyCompatibility: true,
    canonicalFPlusExecutionKeys: true,
    activeFPlusStillCapacityGated: true
  });
})();
