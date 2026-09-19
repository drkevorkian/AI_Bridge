(() => {
  "use strict";

  const ALL_SIDES = Object.freeze(["A", "B", "C", "D", "E"]);
  const FLAG = "__AI_BRIDGE_PROVIDER_HEALTH_ACCESSIBILITY_V1__";
  const LIVE_REGION_ID = "providerHealthLiveRegion";
  if (window[FLAG]) return;

  const byId = id => document.getElementById(id);
  const lastAccessibleStatus = new Map();
  let initialized = false;

  function normalizeStatus(raw) {
    return String(raw || "CHECKING").replaceAll("_", " ").trim() || "CHECKING";
  }

  function accessibleHealthText(side, badge) {
    const status = normalizeStatus(badge?.dataset?.status);
    const reason = String(badge?.title || "").trim();
    const detail = reason && reason !== status ? ` — ${reason}` : "";
    return `AI ${side} health: ${status}${detail}`;
  }

  function ensureLiveRegion() {
    let region = byId(LIVE_REGION_ID);
    if (region) return region;
    const team = document.querySelector(".team-section");
    if (!team || typeof document.createElement !== "function") return null;

    region = document.createElement("div");
    region.id = LIVE_REGION_ID;
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-atomic", "true");
    region.setAttribute("aria-label", "Provider health updates");

    // Visually hidden, but intentionally present in the accessibility tree.
    // This is packaged/static styling only; no provider-derived values enter CSS.
    Object.assign(region.style, {
      position: "absolute",
      width: "1px",
      height: "1px",
      padding: "0",
      margin: "-1px",
      overflow: "hidden",
      clip: "rect(0, 0, 0, 0)",
      whiteSpace: "nowrap",
      border: "0"
    });
    team.appendChild(region);
    return region;
  }

  function refreshHealthAccessibility({ announce = initialized } = {}) {
    const changed = [];
    let updated = 0;

    for (const side of ALL_SIDES) {
      const badge = byId(`health${side}`);
      if (!badge) continue;
      const text = accessibleHealthText(side, badge);
      if (badge.getAttribute("aria-label") !== text) badge.setAttribute("aria-label", text);

      const previous = lastAccessibleStatus.get(side);
      if (announce && previous !== undefined && previous !== text) changed.push(text);
      lastAccessibleStatus.set(side, text);
      updated += 1;
    }

    initialized = true;
    if (changed.length) {
      const region = ensureLiveRegion();
      if (region) region.textContent = changed.join(". ");
    }
    return updated;
  }

  ensureLiveRegion();
  refreshHealthAccessibility({ announce: false });

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
    version: 2,
    dynamicStatusNames: true,
    textOnlyRendering: true,
    politeStatusAnnouncements: true,
    deduplicatedStatusAnnouncements: true,
    refresh: refreshHealthAccessibility
  });
})();
