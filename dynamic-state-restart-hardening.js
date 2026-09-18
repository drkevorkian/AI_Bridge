// AI Bridge dynamic-roster restart hydration hardening.
//
// background.js begins loading persisted state before the dynamic-agent overlay
// is installed. During that early load the legacy A/B/C SIDES seed can filter
// D/E out of phase/cycle lists and can normalize a persisted Main AI back to A.
// This layer re-reads only the persisted coordinator fields that can be damaged
// by that legacy filtering, sanitizes them against the configured 1-5 roster,
// and restores them after the normal load + dynamic migration have completed.
(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_DYNAMIC_RESTART_HYDRATION_V1__";
  if (globalThis[FLAG]) return;

  const caps = globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__;
  const dynamicAgents = globalThis.__AI_BRIDGE_DYNAMIC_AGENTS_V1__;
  const stateV4 = globalThis.__AI_BRIDGE_STATE_V4_PERSISTENCE_V1__ || null;
  if (!caps || caps.version !== 1 || !dynamicAgents || dynamicAgents.version !== 1) {
    throw new Error("Dynamic restart hydration requires the dynamic-agent runtime.");
  }

  const BATCH_MODES = new Set(["compete", "parallel", "review"]);
  const ROUTING_LIST_FIELDS = Object.freeze([
    "cycleParticipants",
    "phasePendingSides",
    "phaseSentSides",
    "phaseCompletedSides"
  ]);

  function liveState() {
    try {
      if (typeof state !== "undefined" && state) return state;
    } catch (_) {}
    return globalThis.state || null;
  }

  function runtimeSnapshotForRestore(snapshot) {
    if (
      Number(snapshot?.stateVersion) === 4 &&
      stateV4?.version === 1 &&
      typeof stateV4.hydratePersistedState === "function"
    ) {
      return stateV4.hydratePersistedState(snapshot);
    }
    return snapshot;
  }

  function sidesForSnapshot(snapshot) {
    const runtimeSnapshot = runtimeSnapshotForRestore(snapshot);
    const rosterCount = Number(runtimeSnapshot?.stateVersion) === 4 && Array.isArray(runtimeSnapshot?.roster?.agents)
      ? runtimeSnapshot.roster.agents.length
      : null;
    const count = caps.normalizeAgentCount(rosterCount ?? runtimeSnapshot?.agentCount, caps.defaultAgentCount);
    return [...caps.sideIdsForCount(count)];
  }

  function sanitizeSideList(raw, allowedSides) {
    const allowed = new Set(allowedSides);
    const out = [];
    for (const item of (Array.isArray(raw) ? raw : [])) {
      const side = String(item || "").toUpperCase();
      if (allowed.has(side) && !out.includes(side)) out.push(side);
    }
    return out;
  }

  function restoreDynamicRoutingFields(current, persisted) {
    if (!current || typeof current !== "object" || !persisted || typeof persisted !== "object") {
      return current;
    }

    let runtimePersisted;
    try {
      runtimePersisted = runtimeSnapshotForRestore(persisted);
    } catch (_) {
      return current;
    }

    if (
      current.stateVersion != null &&
      runtimePersisted.stateVersion != null &&
      Number(current.stateVersion) !== Number(runtimePersisted.stateVersion)
    ) {
      return current;
    }

    const sides = sidesForSnapshot(runtimePersisted);
    const allowed = new Set(sides);

    // Scalars can be irreversibly normalized by the legacy A/B/C load before
    // the dynamic overlay runs. Restore only values valid for the persisted
    // configured roster.
    for (const field of ["startSide", "mainSide", "currentSide"]) {
      const side = String(runtimePersisted[field] || "").toUpperCase();
      if (allowed.has(side)) current[field] = side;
    }

    // Sequential modes use cycleParticipants to track completion of a team
    // cycle, so preserve it for every mode. Batch-only phase lists remain empty
    // outside batch modes, matching background.js's intentional reset behavior.
    current.cycleParticipants = sanitizeSideList(runtimePersisted.cycleParticipants, sides);

    if (BATCH_MODES.has(String(current.workMode || runtimePersisted.workMode || "").toLowerCase())) {
      for (const field of ROUTING_LIST_FIELDS.slice(1)) {
        current[field] = sanitizeSideList(runtimePersisted[field], sides);
      }
    }

    return current;
  }

  async function restorePersistedDynamicRoutingState() {
    const current = liveState();
    if (!current || !chrome?.storage?.local?.get) return current;

    let persisted = null;
    try {
      const stored = await chrome.storage.local.get("bridgeState");
      persisted = stored?.bridgeState || null;
    } catch (_) {
      // Storage failure should not make an otherwise usable worker fail to boot.
      // The base loader already owns storage error/recovery semantics.
      return current;
    }

    if (!persisted || typeof persisted !== "object") return current;
    restoreDynamicRoutingFields(current, persisted);

    // Re-run the existing dynamic migration after scalar/list restoration so
    // SIDES and all side-indexed maps remain aligned with persisted agentCount.
    if (typeof dynamicAgents.migrateDynamicAgentState === "function") {
      dynamicAgents.migrateDynamicAgentState(current);
    }
    return current;
  }

  // Chain behind the already-started base load and coordinator dynamic migration.
  // Message handlers await stateReady, so they cannot observe the filtered state.
  try {
    if (typeof stateReady !== "undefined" && stateReady && typeof stateReady.then === "function") {
      stateReady = stateReady.then(restorePersistedDynamicRoutingState);
    }
  } catch (_) {
    if (globalThis.stateReady && typeof globalThis.stateReady.then === "function") {
      globalThis.stateReady = globalThis.stateReady.then(restorePersistedDynamicRoutingState);
    }
  }

  // Preserve the same guarantee if loadState() is called again later in the
  // worker lifetime. coordinator-dynamic-agents.js already wraps this function;
  // this layer intentionally composes outside that wrapper.
  if (typeof loadState === "function") {
    const baseLoadState = loadState;
    loadState = async function dynamicRestartSafeLoadState() {
      const result = await baseLoadState.apply(this, arguments);
      await restorePersistedDynamicRoutingState();
      return result;
    };
  }

  globalThis[FLAG] = Object.freeze({
    version: 1,
    restoresPersistedMainSide: true,
    restoresPersistedPhaseLists: true,
    restoresPersistedCycleParticipants: true,
    hydratesCanonicalStateV4BeforeRestore: true,
    restoresServiceWorkerQueue: false,
    restoreDynamicRoutingFields,
    restorePersistedDynamicRoutingState
  });
})();
