(() => {
  "use strict";

  // Coordinator migration for selectable logical-agent counts (A-E).
  const FLAG = "__AI_BRIDGE_DYNAMIC_AGENTS_V1__";
  if (globalThis[FLAG]) return;

  const caps = globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__;
  if (!caps || caps.version !== 1 || typeof caps.sideIdsForCount !== "function") {
    throw new Error("Dynamic-agent coordinator requires the capability contract.");
  }

  const ALL_SIDES = Object.freeze([...caps.supportedAgentSides]);
  const DEFAULT_COUNT = caps.defaultAgentCount;

  function liveCount(raw) {
    return caps.normalizeAgentCount(raw == null ? globalThis.state?.agentCount : raw, DEFAULT_COUNT);
  }

  function liveSides(rawCount) {
    return [...caps.sideIdsForCount(liveCount(rawCount))];
  }

  function emptyMap(value, sides = liveSides()) {
    const out = {};
    for (const side of sides) out[side] = value;
    return out;
  }

  function expandMap(raw, value, sides = ALL_SIDES) {
    const src = raw && typeof raw === "object" ? raw : {};
    const out = {};
    for (const side of sides) {
      out[side] = Object.prototype.hasOwnProperty.call(src, side) ? src[side] : value;
    }
    return out;
  }

  function assignLiveSides(count) {
    const next = liveSides(count);
    try {
      SIDES = next;
    } catch (_) {
      // Fail closed if background.js is still a const binding. Helpers use liveSides().
    }
    return next;
  }

  function migrateDynamicAgentState(bridgeState) {
    const next = bridgeState && typeof bridgeState === "object" ? bridgeState : {};
    const count = liveCount(next.agentCount);
    const sides = liveSides(count);
    next.agentCount = count;
    next.activeSides = sides.slice();
    for (const side of ALL_SIDES) {
      if (next[`tab${side}`] === undefined) next[`tab${side}`] = null;
      if (next[`label${side}`] === undefined) next[`label${side}`] = `AI ${side}`;
      if (next[`job${side}`] === undefined) next[`job${side}`] = "";
    }
    next.sourceDeliveredBySide = expandMap(next.sourceDeliveredBySide, false);
    next.lastSentArtifactIdsBySide = expandMap(next.lastSentArtifactIdsBySide, []);
    next.lastDeliveredSeqBySide = expandMap(next.lastDeliveredSeqBySide, 0);
    next.roundStartedAtBySide = expandMap(next.roundStartedAtBySide, null);
    next.roundNumberBySide = expandMap(next.roundNumberBySide, 0);
    next.lastRoundDurationMsBySide = expandMap(next.lastRoundDurationMsBySide, null);
    next.lastRoundCompletedAtBySide = expandMap(next.lastRoundCompletedAtBySide, null);
    next.totalWorkMsBySide = expandMap(next.totalWorkMsBySide, 0);
    next.generationIdBySide = expandMap(next.generationIdBySide, null);
    next.recoveryAttemptBySide = expandMap(next.recoveryAttemptBySide, 0);
    next.lastProgressAtBySide = expandMap(next.lastProgressAtBySide, null);
    next.primaryResponseSeqBySide = expandMap(next.primaryResponseSeqBySide, null);
    next.reviewResponseSeqBySide = expandMap(next.reviewResponseSeqBySide, null);
    if (next.startSide && !sides.includes(next.startSide)) next.startSide = sides[0];
    if (next.mainSide && !sides.includes(next.mainSide)) next.mainSide = next.startSide || sides[0];
    if (next.currentSide && !sides.includes(next.currentSide)) next.currentSide = next.startSide || sides[0];
    assignLiveSides(count);
    return next;
  }

  function uniqueTabIds(tabIds) {
    const ids = tabIds.map(Number);
    if (ids.some(id => !Number.isInteger(id) || id <= 0)) {
      throw new Error(`Choose ${ids.length} supported AI tabs.`);
    }
    if (new Set(ids).size !== ids.length) {
      throw new Error("Each logical agent must use a different browser tab.");
    }
    return ids;
  }

  async function assertProviderPolicy(tabIds) {
    const families = [];
    for (const tabId of tabIds) {
      let tab;
      try {
        tab = await chrome.tabs.get(tabId);
      } catch (_) {
        throw new Error("A selected AI tab is no longer available.");
      }
      const family = caps.providerFamilyForUrl(tab?.url || "");
      if (!family) throw new Error("Every agent must be bound to a supported HTTPS AI tab.");
      families.push(family.id);
    }
    if (!caps.duplicateProviderAgentsEnabled && new Set(families).size !== families.length) {
      throw new Error("Duplicate-provider agents are disabled. Bind each agent to a different AI family, or wait for multi-tab viewpoint mode.");
    }
    return families;
  }

  emptySideMap = function dynamicEmptySideMap(value) {
    return emptyMap(value, liveSides());
  };

  normalizeActiveSides = function dynamicNormalizeActiveSides(raw) {
    const allowed = liveSides();
    const list = Array.isArray(raw) ? raw : allowed;
    const out = [];
    for (const item of list) {
      const side = String(item || "").toUpperCase();
      if (allowed.includes(side) && !out.includes(side)) out.push(side);
    }
    return out.length ? out : allowed.slice();
  };

  nextSide = function dynamicNextSide(side) {
    const roster = liveSides();
    const idx = roster.indexOf(side);
    return idx < 0 ? roster[0] : roster[(idx + 1) % roster.length];
  };

  sideForTab = function dynamicSideForTab(tabId) {
    const id = Number(tabId);
    if (!Number.isInteger(id) || id <= 0) return null;
    return liveSides().find(side => Number(tabForSide(side)) === id) || null;
  };

  sanitizeForceRelaySides = function dynamicSanitizeForceRelaySides(raw) {
    const allowed = liveSides();
    const values = Array.isArray(raw) ? raw : [raw];
    const unique = [];
    for (const value of values) {
      const side = String(value || "").toUpperCase();
      if (allowed.includes(side) && !unique.includes(side)) unique.push(side);
    }
    return unique;
  };

  const baseCloneDefaultState = typeof cloneDefaultState === "function" ? cloneDefaultState : null;
  cloneDefaultState = function dynamicCloneDefaultState() {
    const next = baseCloneDefaultState ? baseCloneDefaultState() : {};
    return migrateDynamicAgentState(next);
  };

  bindTabsFromMessage = async function dynamicBindTabsFromMessage(msg) {
    const sides = liveSides();
    const tabIds = uniqueTabIds(sides.map(side => Number(msg[`tab${side}`])));
    await assertProviderPolicy(tabIds);
    await Promise.all(tabIds.map(ensureTabListener));
    for (const side of sides) {
      const previousTab = Number(state[`tab${side}`]);
      const nextTab = Number(msg[`tab${side}`]);
      state[`tab${side}`] = nextTab;
      if (msg[`label${side}`]) state[`label${side}`] = String(msg[`label${side}`]);
      if (typeof isBatchWorkMode === "function" && isBatchWorkMode() && state.phasePendingSides.includes(side) && previousTab !== nextTab) {
        state.phaseSentSides = state.phaseSentSides.filter(item => item !== side);
        delete state.lastResponseBySide[side];
      }
    }
  };

  async function applyAgentCount(rawCount, { persist = true } = {}) {
    if (globalThis.state?.sessionActive) {
      throw new Error("Stop the session before changing how many agents are on the team.");
    }
    const count = caps.parseAgentCount(rawCount);
    if (count === null) {
      throw new RangeError(`Agent count must be an integer from 1 to ${caps.maxUniqueProviderAgents}.`);
    }
    const next = migrateDynamicAgentState({ ...(globalThis.state || {}), agentCount: count });
    if (globalThis.state) Object.assign(globalThis.state, next);
    assignLiveSides(count);
    if (persist && typeof saveState === "function") await saveState();
    return { agentCount: count, sides: liveSides(count) };
  }

  if (globalThis.state) migrateDynamicAgentState(globalThis.state);
  assignLiveSides(globalThis.state?.agentCount);

  if (chrome?.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || msg.type !== "AI_BRIDGE_SET_AGENT_COUNT") return;
      Promise.resolve()
        .then(async () => {
          if (typeof requireExtensionPage === "function") {
            requireExtensionPage(sender, "Set agent count");
          } else {
            const prefix = chrome.runtime.getURL("");
            const url = String(sender?.url || "");
            if (!url.startsWith(prefix)) throw new Error("Set agent count is only available from the dashboard or popup.");
          }
          return applyAgentCount(msg.agentCount);
        })
        .then(result => sendResponse({ ok: true, ...result }))
        .catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
      return true;
    });
  }

  globalThis.applyAgentCount = applyAgentCount;
  globalThis.migrateDynamicAgentState = migrateDynamicAgentState;
  globalThis[FLAG] = Object.freeze({
    version: 1,
    allSides: ALL_SIDES,
    liveSides,
    liveCount,
    migrateDynamicAgentState,
    applyAgentCount,
    uniqueTabBinding: true,
    duplicateProviderAgentsEnabled: caps.duplicateProviderAgentsEnabled === true
  });
})();
