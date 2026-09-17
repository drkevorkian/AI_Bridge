(() => {
  "use strict";

  const ALL_SIDES = Object.freeze(["A", "B", "C", "D", "E"]);
  const FLAG = "__AI_BRIDGE_PROVIDER_HEALTH_ACCESSIBILITY_V1__";
  if (window[FLAG]) return;

  const byId = id => document.getElementById(id);

  function normalizeStatus(raw) {
    return String(raw || "CHECKING").replaceAll("_", " ").trim() || "CHECKING";
  }

  function refreshHealthAccessibility() {
    let updated = 0;
    for (const side of ALL_SIDES) {
      const badge = byId(`health${side}`);
      if (!badge) continue;
      const status = normalizeStatus(badge.dataset?.status);
      const reason = String(badge.title || "").trim();
      const detail = reason && reason !== status ? ` — ${reason}` : "";
      badge.setAttribute("aria-label", `AI ${side} health: ${status}${detail}`);
      updated += 1;
    }
    return updated;
  }

  refreshHealthAccessibility();

  const team = document.querySelector(".team-section");
  if (team && typeof MutationObserver === "function") {
    const observer = new MutationObserver(records => {
      if (records.some(record =>
        record.type === "childList" ||
        (record.type === "attributes" && (record.attributeName === "data-status" || record.attributeName === "title"))
      )) {
        refreshHealthAccessibility();
      }
    });
    observer.observe(team, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-status", "title"]
    });
  }

  window[FLAG] = Object.freeze({
    version: 1,
    dynamicStatusNames: true,
    textOnlyRendering: true,
    refresh: refreshHealthAccessibility
  });
})();
