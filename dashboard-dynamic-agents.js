(() => {
  "use strict";

  const ALL_SIDES = Object.freeze(["A", "B", "C", "D", "E"]);
  const DEFAULT_COUNT = 3;
  const HEALTH_POLL_MS = 1500;
  const EXTENDED_SIDES = new Set(["D", "E"]);
  const cardCache = new Map();
  let lastHealth = null;
  let activeCount = DEFAULT_COUNT;
  let healthTimer = null;

  const byId = id => document.getElementById(id);

  function liveSides(count = activeCount) {
    return ALL_SIDES.slice(0, Math.max(1, Math.min(ALL_SIDES.length, Number(count) || DEFAULT_COUNT)));
  }

  function mutateLegacySides(count) {
    const next = liveSides(count);
    try {
      if (Array.isArray(SIDES)) SIDES.splice(0, SIDES.length, ...next);
    } catch (_) {}
    return next;
  }

  function createStatusBadge(side) {
    const badge = document.createElement("div");
    badge.id = `health${side}`;
    badge.className = "status-badge dynamic-health-badge";
    badge.dataset.status = "CHECKING";
    badge.setAttribute("aria-label", `AI ${side} health`);

    const label = document.createElement("span");
    label.className = "status-label";
    label.textContent = "CHECKING";
    badge.appendChild(label);
    return badge;
  }

  function ensureHealthBadge(card, side) {
    let badge = byId(`health${side}`);
    if (badge) return badge;
    badge = createStatusBadge(side);
    const identity = card.querySelector(".agent-identity") || card.querySelector(".agent-topline") || card;
    identity.appendChild(badge);
    return badge;
  }

  function createExtendedCard(side) {
    const card = document.createElement("article");
    card.className = `agent-card agent-${side.toLowerCase()}`;
    card.dataset.side = side;

    const topline = document.createElement("div");
    topline.className = "agent-topline";

    const identity = document.createElement("div");
    identity.className = "agent-identity";
    const title = document.createElement("strong");
    title.id = `labelText${side}`;
    title.textContent = `AI ${side}`;
    identity.appendChild(title);

    const timers = document.createElement("div");
    timers.className = "agent-timers";
    const total = document.createElement("span");
    total.id = `timerTotal${side}`;
    total.className = "round-timer idle";
    total.title = "Total working time for this LLM in the current session";
    total.textContent = "Total 0s";
    const current = document.createElement("span");
    current.id = `timerCurrent${side}`;
    current.className = "round-timer idle";
    current.title = "Current turn timer for this LLM";
    current.textContent = "Current —";
    timers.append(total, current);
    identity.appendChild(timers);
    identity.appendChild(createStatusBadge(side));

    const actions = document.createElement("div");
    actions.className = "agent-actions";
    const newChat = document.createElement("button");
    newChat.id = `newChat${side}`;
    newChat.className = "tiny ghost";
    newChat.type = "button";
    newChat.textContent = "New chat";
    const resendButton = document.createElement("button");
    resendButton.id = `resend${side}`;
    resendButton.className = "tiny ghost";
    resendButton.type = "button";
    resendButton.disabled = true;
    resendButton.textContent = "Resend";
    const useLast = document.createElement("button");
    useLast.id = `useLast${side}`;
    useLast.className = "tiny ghost";
    useLast.type = "button";
    useLast.disabled = true;
    useLast.textContent = "Use last reply";
    actions.append(newChat, resendButton, useLast);
    topline.append(identity, actions);

    const tabSelect = document.createElement("select");
    tabSelect.id = `tab${side}`;
    tabSelect.setAttribute("aria-label", `AI ${side} tab`);
    const job = document.createElement("textarea");
    job.id = `job${side}`;
    job.rows = 3;
    job.placeholder = `AI ${side} job / responsibility`;

    card.append(topline, tabSelect, job);
    return card;
  }

  function attachExtendedListeners(side) {
    if (!EXTENDED_SIDES.has(side)) return;
    const tab = byId(`tab${side}`);
    const newChat = byId(`newChat${side}`);
    const resendButton = byId(`resend${side}`);
    const useLast = byId(`useLast${side}`);
    if (tab && !tab.dataset.dynamicBound) {
      tab.dataset.dynamicBound = "true";
      tab.addEventListener("change", () => {
        try { if (typeof refreshStartLabels === "function") refreshStartLabels(); } catch (_) {}
        try { if (typeof updateControls === "function" && typeof latestState !== "undefined" && latestState) updateControls(latestState); } catch (_) {}
        refreshHealth(true).catch(() => {});
      });
    }
    if (newChat && !newChat.dataset.dynamicBound) {
      newChat.dataset.dynamicBound = "true";
      newChat.addEventListener("click", () => {
        try { if (typeof openFreshChats === "function") openFreshChats([side]); } catch (_) {}
      });
    }
    if (resendButton && !resendButton.dataset.dynamicBound) {
      resendButton.dataset.dynamicBound = "true";
      resendButton.addEventListener("click", () => {
        try { if (typeof resend === "function") resend(side); } catch (_) {}
      });
    }
    if (useLast && !useLast.dataset.dynamicBound) {
      useLast.dataset.dynamicBound = "true";
      useLast.addEventListener("click", () => {
        try {
          if (typeof setForceSource === "function") setForceSource(side);
          byId("forceRelayBtn")?.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch (_) {}
      });
    }
  }

  function ensureManualRelayControls(side) {
    const fromHost = document.querySelector(".manual-relay-from");
    const toHost = document.querySelector(".manual-relay-to");
    if (!fromHost || !toHost) return;

    let from = byId(`forceFrom${side}`);
    if (!from) {
      from = document.createElement("button");
      from.id = `forceFrom${side}`;
      from.className = "layout-chip";
      from.type = "button";
      from.setAttribute("aria-pressed", "false");
      from.textContent = side;
      fromHost.appendChild(from);
      from.addEventListener("click", () => {
        try { if (typeof setForceSource === "function") setForceSource(side); } catch (_) {}
      });
    }

    let to = byId(`forceTo${side}`);
    if (!to) {
      const label = document.createElement("label");
      label.className = "check-line";
      to = document.createElement("input");
      to.id = `forceTo${side}`;
      to.type = "checkbox";
      label.append(to, document.createTextNode(` ${side}`));
      toHost.appendChild(label);
    }
  }

  function setControlVisibility(side, visible) {
    const card = cardCache.get(side);
    if (card) card.hidden = !visible;
    const from = byId(`forceFrom${side}`);
    if (from) from.hidden = !visible;
    const to = byId(`forceTo${side}`);
    if (to?.parentElement) to.parentElement.hidden = !visible;
  }

  function ensureCards() {
    const team = document.querySelector(".team-section");
    const relayPanel = document.querySelector(".manual-relay-panel");
    if (!team || !relayPanel) return false;

    for (const side of ["A", "B", "C"]) {
      const card = document.querySelector(`.agent-${side.toLowerCase()}`);
      if (card) {
        card.dataset.side = side;
        cardCache.set(side, card);
        ensureHealthBadge(card, side);
      }
    }

    for (const side of ["D", "E"]) {
      let card = cardCache.get(side) || document.querySelector(`.agent-${side.toLowerCase()}`);
      if (!card) card = createExtendedCard(side);
      cardCache.set(side, card);
      if (!card.isConnected) team.insertBefore(card, relayPanel);
      ensureManualRelayControls(side);
      attachExtendedListeners(side);
    }
    return true;
  }

  function updateStartSideOptions(sides) {
    const select = byId("startSide");
    if (!select) return;
    const previous = select.value;
    select.replaceChildren();
    for (const side of sides) {
      const option = document.createElement("option");
      option.value = side;
      option.textContent = `${byId(`labelText${side}`)?.textContent || `AI ${side}`} — Main`;
      select.appendChild(option);
    }
    select.value = sides.includes(previous) ? previous : sides[0];
  }

  function updateStaticCopy(sides) {
    const route = sides.join(" → ");
    const heading = document.querySelector(".team-section > .section-heading .muted");
    if (heading) heading.textContent = route;
    const brand = document.querySelector(".brand-block h1");
    if (brand) brand.textContent = `${sides.length} agents. One workspace.`;
    const runtimeHelp = document.querySelector(".runtime-card .field-help");
    if (runtimeHelp) runtimeHelp.textContent = `Uses the ${sides.length} selected, already-open AI tabs. AI Bridge never opens replacement AI tabs for this action.`;
    const manualHelp = document.querySelector(".manual-relay-panel .field-help");
    if (manualHelp) manualHelp.textContent = `If an AI finished on its tab but the bridge never picked that up, re-read the visible reply and send it to any combination of ${sides.join(", ")}.`;
  }

  function ensureCountControl() {
    if (byId("agentCount")) return;
    const team = document.querySelector(".team-section");
    const heading = team?.querySelector(":scope > .section-heading");
    if (!team || !heading) return;

    const wrap = document.createElement("div");
    wrap.className = "dynamic-agent-count";
    const label = document.createElement("label");
    label.htmlFor = "agentCount";
    label.textContent = "Agents";
    const select = document.createElement("select");
    select.id = "agentCount";
    select.setAttribute("aria-label", "Number of logical AI agents");
    for (let n = 1; n <= ALL_SIDES.length; n += 1) {
      const option = document.createElement("option");
      option.value = String(n);
      option.textContent = String(n);
      select.appendChild(option);
    }
    const recommendation = document.createElement("div");
    recommendation.id = "adaptiveRecommendation";
    recommendation.className = "field-help dynamic-agent-recommendation";
    recommendation.textContent = "Provider health: checking…";
    wrap.append(label, select, recommendation);
    heading.insertAdjacentElement("afterend", wrap);

    select.addEventListener("change", async () => {
      const requested = Number(select.value);
      select.disabled = true;
      try {
        const result = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_SET_AGENT_COUNT", agentCount: requested });
        if (!result?.ok) throw new Error(result?.error || "Could not change agent count.");
        activeCount = Number(result.agentCount) || DEFAULT_COUNT;
        renderRoster(activeCount);
        await refreshTabsSafely();
        await refreshHealth(true);
      } catch (error) {
        select.value = String(activeCount);
        const status = byId("status");
        if (status) status.textContent = String(error?.message || error);
      } finally {
        select.disabled = Boolean(typeof latestState !== "undefined" && latestState?.sessionActive);
      }
    });
  }

  function renderRoster(count) {
    activeCount = Math.max(1, Math.min(ALL_SIDES.length, Number(count) || DEFAULT_COUNT));
    const sides = mutateLegacySides(activeCount);
    ensureCards();
    for (const side of ALL_SIDES) setControlVisibility(side, sides.includes(side));
    for (const side of sides) {
      const card = cardCache.get(side);
      const relayPanel = document.querySelector(".manual-relay-panel");
      if (card && relayPanel && !card.isConnected) relayPanel.parentElement.insertBefore(card, relayPanel);
    }
    updateStartSideOptions(sides);
    updateStaticCopy(sides);
    const countSelect = byId("agentCount");
    if (countSelect) {
      countSelect.value = String(activeCount);
      countSelect.disabled = Boolean(typeof latestState !== "undefined" && latestState?.sessionActive);
    }
    const team = document.querySelector(".team-section");
    if (team) team.dataset.agentCount = String(activeCount);
    try { if (typeof refreshStartLabels === "function") refreshStartLabels(); } catch (_) {}
    return sides;
  }

  async function refreshTabsSafely() {
    try {
      if (typeof refreshTabs === "function") await refreshTabs();
    } catch (_) {}
  }

  function applyHealth(health) {
    lastHealth = health || null;
    const sides = liveSides();
    for (const side of sides) {
      const row = health?.bySide?.[side];
      const status = String(row?.status || "CHECKING");
      const badge = byId(`health${side}`);
      if (!badge) continue;
      badge.dataset.status = status;
      badge.title = String(row?.reason || status);
      const label = badge.querySelector(".status-label");
      if (label) label.textContent = status.replaceAll("_", " ");
      const card = cardCache.get(side);
      if (card) card.dataset.healthStatus = status;
    }

    const blocked = sides.filter(side => !health?.bySide?.[side]?.ready);
    const start = byId("start");
    if (start) {
      start.dataset.healthBlocked = blocked.length ? "true" : "false";
      start.title = blocked.length
        ? `Resolve provider health for: ${blocked.join(", ")}`
        : "All selected provider tabs are reachable.";
    }
  }

  async function refreshHealth(force = false) {
    const response = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_PROVIDER_HEALTH", force });
    if (!response?.ok) throw new Error(response?.error || "Provider health check failed.");
    applyHealth(response.health);

    const adaptive = await chrome.runtime.sendMessage({
      type: "AI_BRIDGE_ADAPTIVE_SELECT",
      force: false,
      preferredSide: byId("startSide")?.value || "A"
    });
    const recommendation = byId("adaptiveRecommendation");
    if (recommendation && adaptive?.ok) {
      recommendation.textContent = `Adaptive start: AI ${adaptive.recommendation?.side || "A"} — ${adaptive.recommendation?.reason || "No recommendation."}`;
    }
    return response.health;
  }

  function installStartGuard() {
    const start = byId("start");
    if (!start || start.dataset.dynamicGuardBound) return;
    start.dataset.dynamicGuardBound = "true";
    start.addEventListener("click", event => {
      const sides = liveSides();
      const blocked = sides.filter(side => !lastHealth?.bySide?.[side]?.ready);
      if (!blocked.length) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const status = byId("status");
      if (status) status.textContent = `Cannot start: resolve provider health for AI ${blocked.join(", AI ")}.`;
      refreshHealth(true).catch(() => {});
    }, true);
  }

  function installStartPayloadAugmenter() {
    if (chrome.runtime.__aiBridgeDynamicSendWrapped) return;
    const nativeSend = chrome.runtime.sendMessage.bind(chrome.runtime);
    const wrapped = function dynamicDashboardSendMessage(message) {
      if (message && typeof message === "object" && message.type === "AI_BRIDGE_START") {
        const copy = { ...message };
        for (const side of liveSides()) {
          const tab = byId(`tab${side}`);
          const job = byId(`job${side}`);
          copy[`tab${side}`] = Number(tab?.value || copy[`tab${side}`] || 0) || null;
          copy[`job${side}`] = String(job?.value || copy[`job${side}`] || "").trim();
          copy[`label${side}`] = `AI ${side}`;
        }
        return nativeSend(copy);
      }
      return nativeSend(message);
    };
    wrapped.__aiBridgeDynamicSendWrapped = true;
    chrome.runtime.sendMessage = wrapped;
    try { chrome.runtime.__aiBridgeDynamicSendWrapped = true; } catch (_) {}
  }

  async function initialState() {
    const response = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_GET_STATE", includeSources: false, afterSeq: 0 });
    const state = response?.state || null;
    if (state) {
      activeCount = Number(state.agentCount) || DEFAULT_COUNT;
      renderRoster(activeCount);
      for (const side of liveSides()) {
        const job = byId(`job${side}`);
        if (job && typeof state[`job${side}`] === "string") job.value = state[`job${side}`];
        const labelText = byId(`labelText${side}`);
        if (labelText) labelText.textContent = String(state[`label${side}`] || `AI ${side}`);
      }
      const countSelect = byId("agentCount");
      if (countSelect) countSelect.disabled = Boolean(state.sessionActive);
    }
    await refreshTabsSafely();
    await refreshHealth(true);
  }

  function installStyles() {
    if (document.querySelector("link[data-ai-bridge-dynamic-agents]")) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("dashboard-dynamic-agents.css");
    link.dataset.aiBridgeDynamicAgents = "true";
    document.head.appendChild(link);
  }

  async function bootstrap() {
    installStyles();
    ensureCountControl();
    ensureCards();
    installStartPayloadAugmenter();
    installStartGuard();
    await initialState();
    if (healthTimer) clearInterval(healthTimer);
    healthTimer = setInterval(() => refreshHealth(false).catch(() => {}), HEALTH_POLL_MS);
    window.__AI_BRIDGE_DYNAMIC_DASHBOARD_V1__ = Object.freeze({
      version: 1,
      maxAgents: ALL_SIDES.length,
      duplicateProviderAgentsEnabled: false,
      renderRoster,
      refreshHealth
    });
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", () => bootstrap().catch(error => console.error("AI Bridge dynamic dashboard failed", error)), { once: true });
  } else {
    bootstrap().catch(error => console.error("AI Bridge dynamic dashboard failed", error));
  }
})();
