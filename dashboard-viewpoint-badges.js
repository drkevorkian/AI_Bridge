(() => {
  "use strict";

  // Cosmetic same-provider viewpoint labels.
  //
  // Provider Health intentionally redacts worker-only tab/thread identity before
  // crossing into extension pages. This adapter therefore derives viewpoint
  // numbering solely from the public health roster order + providerId and reuses
  // the already-sanitized threadPath. It never needs raw tab IDs, provenance IDs,
  // or internal thread keys.
  const FLAG = "__AI_BRIDGE_VIEWPOINT_BADGES_V1__";
  if (window[FLAG]) return;

  const MAX_THREAD_BADGE_CHARS = 18;
  let observer = null;
  let refreshScheduled = false;

  const byId = id => document.getElementById(id);

  function formatThreadPath(rawPath) {
    const value = String(rawPath || "").split("?")[0].split("#")[0];
    if (!value.startsWith("/")) return "";
    return value.length > MAX_THREAD_BADGE_CHARS
      ? `${value.slice(0, MAX_THREAD_BADGE_CHARS - 1)}…`
      : value;
  }

  function viewpointRows(health) {
    const sides = Array.isArray(health?.sides) ? health.sides.map(side => String(side)) : [];
    const groups = new Map();

    for (const side of sides) {
      const row = health?.bySide?.[side] || null;
      const providerId = String(row?.providerId || "");
      if (!providerId) continue;
      const group = groups.get(providerId) || [];
      group.push(side);
      groups.set(providerId, group);
    }

    const out = new Map();
    for (const [providerId, group] of groups.entries()) {
      if (group.length < 2) continue;
      group.forEach((side, index) => {
        out.set(side, Object.freeze({
          providerId,
          index: index + 1,
          count: group.length
        }));
      });
    }
    return out;
  }

  function cardForSide(side) {
    const normalized = String(side || "").toLowerCase();
    return normalized ? document.querySelector(`.agent-card.agent-${normalized}`) : null;
  }

  function addDescriptionToken(card, token) {
    if (!card || !token) return;
    const tokens = new Set(String(card.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
    tokens.add(token);
    card.setAttribute("aria-describedby", [...tokens].join(" "));
  }

  function removeDescriptionToken(card, token) {
    if (!card || !token) return;
    const tokens = String(card.getAttribute("aria-describedby") || "")
      .split(/\s+/)
      .filter(value => value && value !== token);
    if (tokens.length) card.setAttribute("aria-describedby", tokens.join(" "));
    else card.removeAttribute("aria-describedby");
  }

  function clearViewpointBadge(side) {
    const badge = byId(`threadBadge${side}`);
    if (!badge) return;
    const card = cardForSide(side);
    removeDescriptionToken(card, badge.id);

    if (badge.dataset.viewpointOwned === "true") {
      badge.textContent = "";
      badge.title = "";
      badge.hidden = true;
      badge.removeAttribute("aria-label");
      delete badge.dataset.viewpointOwned;
      delete badge.dataset.viewpointIndex;
      delete badge.dataset.viewpointCount;
    }
  }

  function applyViewpointBadges(health) {
    const rows = viewpointRows(health);
    for (const side of Array.isArray(health?.sides) ? health.sides : []) {
      const normalizedSide = String(side);
      const badge = byId(`threadBadge${normalizedSide}`);
      if (!badge) continue;

      const viewpoint = rows.get(normalizedSide);
      if (!viewpoint) {
        clearViewpointBadge(normalizedSide);
        continue;
      }

      const row = health?.bySide?.[normalizedSide] || null;
      const thread = formatThreadPath(row?.threadPath);
      const providerName = String(row?.providerName || "Provider");
      const label = `Viewpoint #${viewpoint.index}`;
      const visibleText = thread ? `${label} · ${thread}` : label;
      const accessibleText = thread
        ? `${providerName} viewpoint ${viewpoint.index} of ${viewpoint.count}; conversation thread ${thread}`
        : `${providerName} viewpoint ${viewpoint.index} of ${viewpoint.count}`;

      // All strings are assigned as text/attributes; none are interpreted as HTML.
      badge.textContent = visibleText;
      badge.title = accessibleText;
      badge.setAttribute("aria-label", accessibleText);
      badge.dataset.viewpointOwned = "true";
      badge.dataset.viewpointIndex = String(viewpoint.index);
      badge.dataset.viewpointCount = String(viewpoint.count);
      badge.hidden = false;

      // Keep the card's primary accessible name tied to its stable AI-side title
      // via aria-labelledby. Add the sanitized viewpoint badge only as a
      // description so entering the card announces provider/viewpoint context
      // without replacing or duplicating the logical-slot identity.
      addDescriptionToken(cardForSide(normalizedSide), badge.id);
    }
    return rows;
  }

  function committedHealth() {
    const dashboard = window.__AI_BRIDGE_DYNAMIC_DASHBOARD_V1__;
    if (!dashboard || dashboard.committedHealthSnapshot !== true || typeof dashboard.getCommittedHealth !== "function") {
      return null;
    }
    return dashboard.getCommittedHealth();
  }

  function refreshViewpointBadges() {
    if (document.hidden) return null;
    const health = committedHealth();
    if (!health) return null;
    applyViewpointBadges(health);
    return health;
  }

  function scheduleRefresh() {
    if (refreshScheduled) return;
    refreshScheduled = true;
    queueMicrotask(() => {
      refreshScheduled = false;
      refreshViewpointBadges();
    });
  }

  function start() {
    // The dynamic dashboard rewrites adaptiveRecommendation only after it has
    // atomically committed the matching Provider Health snapshot. Observe that
    // existing cadence and read the exact committed snapshot synchronously from
    // the dashboard API. No second Adaptive Selector request or probe is needed.
    const cadenceAnchor = byId("adaptiveRecommendation");
    if (cadenceAnchor && typeof MutationObserver === "function") {
      observer = new MutationObserver(() => scheduleRefresh());
      observer.observe(cadenceAnchor, { childList: true, subtree: true, characterData: true });
    }
    scheduleRefresh();
    window.addEventListener("pagehide", () => {
      observer?.disconnect();
      observer = null;
    }, { once: true });
  }

  window[FLAG] = Object.freeze({
    version: 1,
    exposesSensitiveIdentity: false,
    usesRedactedProviderHealth: true,
    viewpointIndexFromRosterOrder: true,
    usesTextContentOnly: true,
    cardDescribedBySanitizedViewpoint: true,
    usesCommittedDashboardHealth: true,
    independentTimer: false,
    applyViewpointBadges,
    refreshViewpointBadges
  });

  start();
})();