(() => {
  "use strict";

  const ALL_SIDES = Object.freeze(["A", "B", "C", "D", "E"]);
  const FLAG = "__AI_BRIDGE_DYNAMIC_ACCESSIBILITY_V1__";
  if (window[FLAG]) return;

  const byId = id => document.getElementById(id);

  function ensureCardAccessibility(side) {
    const card = document.querySelector(`.agent-${side.toLowerCase()}`);
    if (!card) return false;

    let title = byId(`labelText${side}`) || card.querySelector(".agent-identity > strong") || card.querySelector(".agent-topline strong");
    if (title && !title.id) title.id = `labelText${side}`;

    if (title?.id) card.setAttribute("aria-labelledby", title.id);
    else card.setAttribute("aria-label", `AI ${side}`);

    const tab = byId(`tab${side}`);
    if (tab) tab.setAttribute("aria-label", `AI ${side} tab`);

    const job = byId(`job${side}`);
    if (job) job.setAttribute("aria-label", `AI ${side} job / responsibility`);

    const names = Object.freeze({
      newChat: "new chat",
      resend: "resend last prompt",
      useLast: "use last reply for manual relay"
    });
    for (const [prefix, action] of Object.entries(names)) {
      const control = byId(`${prefix}${side}`);
      if (control) control.setAttribute("aria-label", `AI ${side} ${action}`);
    }

    return true;
  }

  function refreshAccessibleNames() {
    let updated = 0;
    for (const side of ALL_SIDES) {
      if (ensureCardAccessibility(side)) updated += 1;
    }
    return updated;
  }

  refreshAccessibleNames();

  const team = document.querySelector(".team-section");
  if (team && typeof MutationObserver === "function") {
    const observer = new MutationObserver(() => refreshAccessibleNames());
    observer.observe(team, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-agent-count"]
    });
  }

  window[FLAG] = Object.freeze({
    version: 1,
    sideSpecificControlNames: true,
    labelsStaticAndDynamicCards: true,
    textOnlyRendering: true,
    refresh: refreshAccessibleNames
  });
})();
