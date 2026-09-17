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

  window.__AI_BRIDGE_DYNAMIC_TAB_VALIDATION__ = Object.freeze({
    version: 1,
    dynamicAgentCount: true,
    uniquePhysicalTabsRequired: true,
    backgroundEvaluatorAuthoritative: true
  });
})();
