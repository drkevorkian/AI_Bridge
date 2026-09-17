(() => {
  "use strict";

  function selectedSides() {
    try {
      if (Array.isArray(SIDES) && SIDES.length) return [...SIDES];
    } catch (_) {}
    return ["A", "B", "C"];
  }

  function selectedTabIds(sides) {
    return sides.map(side => {
      try { return typeof selectedTab === "function" ? selectedTab(side) : null; }
      catch (_) { return null; }
    });
  }

  function formatSideList(sides) {
    if (sides.length <= 1) return sides.length ? `AI ${sides[0]}` : "the selected AI";
    if (sides.length === 2) return `AI ${sides[0]} and AI ${sides[1]}`;
    return `${sides.slice(0, -1).map(side => `AI ${side}`).join(", ")}, and AI ${sides.at(-1)}`;
  }

  function dynamicTabValidation() {
    const sides = selectedSides();
    const ids = selectedTabIds(sides);
    const count = sides.length;

    if (ids.some(id => !id)) {
      return `Choose ${count} supported AI tab${count === 1 ? "" : "s"}.`;
    }

    if (new Set(ids).size !== ids.length) {
      return `${formatSideList(sides)} must use ${count === 1 ? "a supported tab" : "different tabs"}.`;
    }

    return null;
  }

  function sameRoster(chosen, roster) {
    return chosen.length === roster.length && chosen.every((side, index) => side === roster[index]);
  }

  function availableSupportedTabCount() {
    try {
      return tabsById instanceof Map ? tabsById.size : 0;
    } catch (_) {
      return 0;
    }
  }

  function refreshTabCapacityStatus() {
    const status = document.getElementById("status");
    if (!status) return;

    const required = selectedSides().length;
    const available = availableSupportedTabCount();
    const legacyWarning = "Open at least three supported AI chat tabs, then click Refresh AI tabs.";

    if (available < required) {
      status.textContent = `Open at least ${required} supported AI chat tab${required === 1 ? "" : "s"}, then click Refresh AI tabs.`;
      return;
    }

    // For 1-2 agent rosters the legacy loader may have emitted its fixed-three
    // warning even though enough supported tabs are already available. Replace
    // only that exact legacy message so unrelated status output is preserved.
    if (status.textContent === legacyWarning) {
      status.textContent = `${available} supported AI chat tab${available === 1 ? "" : "s"} ready for ${required} selected agent${required === 1 ? "" : "s"}.`;
    }
  }

  // dashboard.js predates the dynamic A-E roster and its legacy validator still
  // compares the number of unique tabs to the literal value 3. The Start and
  // Resume click handlers resolve this binding when they run, so replacing the
  // global function here preserves those mature handlers while removing only the
  // stale fixed-three assumption. The background binding evaluator remains the
  // authoritative security layer for provider, tab, and conversation identity.
  try {
    if (typeof validateThreeTabs === "function") {
      validateThreeTabs = dynamicTabValidation;
    }
  } catch (error) {
    console.error("AI Bridge could not install dynamic dashboard tab validation", error);
  }

  // The legacy tab loader reports capacity against a literal threshold of three.
  // Reconcile only its post-refresh feedback against the active roster. This is
  // advisory UI feedback; Start/Resume still run dynamic validation and the
  // background binding evaluator remains authoritative and fail-closed.
  try {
    if (typeof loadTabs === "function" && !loadTabs.__aiBridgeDynamicCapacity) {
      const baseLoadTabs = loadTabs;
      const wrappedLoadTabs = async function dynamicLoadTabs(options) {
        const result = await baseLoadTabs(options);
        refreshTabCapacityStatus();
        return result;
      };
      wrappedLoadTabs.__aiBridgeDynamicCapacity = true;
      loadTabs = wrappedLoadTabs;
    }
  } catch (error) {
    console.error("AI Bridge could not install dynamic tab refresh feedback", error);
  }

  // The legacy fresh-chat helper validates and manages the shared "New all"
  // button only when exactly three sides are requested. Wrap only full-roster
  // calls outside that legacy case so 1/2/4/5-agent sessions get equivalent early
  // validation and busy-state behavior without changing single-side reset logic.
  try {
    if (typeof openFreshChats === "function" && !openFreshChats.__aiBridgeDynamicValidation) {
      const baseOpenFreshChats = openFreshChats;
      const wrappedOpenFreshChats = async function dynamicOpenFreshChats(sides) {
        const roster = selectedSides();
        const chosen = Array.isArray(sides) ? [...sides] : roster;
        if (!sameRoster(chosen, roster) || chosen.length === 3) {
          return baseOpenFreshChats(sides);
        }

        const error = dynamicTabValidation();
        if (error) {
          const status = document.getElementById("status");
          if (status) status.textContent = error;
          return;
        }

        const button = document.getElementById("newAllChats");
        const oldText = button?.textContent;
        const oldDisabled = button?.disabled;
        if (button) {
          button.textContent = "Opening…";
          button.disabled = true;
        }
        try {
          return await baseOpenFreshChats(sides);
        } finally {
          if (button) {
            button.textContent = oldText;
            button.disabled = Boolean(oldDisabled);
          }
        }
      };
      wrappedOpenFreshChats.__aiBridgeDynamicValidation = true;
      openFreshChats = wrappedOpenFreshChats;
    }
  } catch (error) {
    console.error("AI Bridge could not install dynamic fresh-chat validation", error);
  }

  window.__AI_BRIDGE_DYNAMIC_TAB_VALIDATION__ = Object.freeze({
    version: 3,
    dynamicAgentCount: true,
    uniquePhysicalTabsRequired: true,
    dynamicTabRefreshFeedback: true,
    dynamicFreshChatValidation: true,
    backgroundEvaluatorAuthoritative: true
  });
})();
