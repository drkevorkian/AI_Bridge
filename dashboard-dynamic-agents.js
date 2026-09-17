(() => {
  "use strict";

  const ALL_SIDES = Object.freeze(["A", "B", "C", "D", "E"]);
  const DEFAULT_COUNT = 3;
  const HEALTH_POLL_MS = 1500;
  const cardCache = new Map();
  let activeCount = DEFAULT_COUNT;
  let lastHealth = null;
  let healthTimer = null;

  const byId = id => document.getElementById(id);

  function liveSides(count = activeCount) {
    const n = Math.max(1, Math.min(ALL_SIDES.length, Number(count) || DEFAULT_COUNT));
    return ALL_SIDES.slice(0, n);
  }

  function mutateLegacySides(count) {
    const next = liveSides(count);
    try {
      if (Array.isArray(SIDES)) SIDES.splice(0, SIDES.length, ...next);
    } catch (_) {}
    return next;
  }

  function formatThreadBadgeText(rawPath) {
    const value = String(rawPath || "").split("?")[0].split("#")[0];
    if (!value.startsWith("/")) return "";
    return value.length > 18 ? `${value.slice(0, 17)}…` : value;
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

  function createThreadBadge(side) {
    const badge = document.createElement("span");
    badge.id = `threadBadge${side}`;
    badge.className = "agent-card-thread-badge";
    badge.hidden = true;
    badge.setAttribute("aria-label", `AI ${side} conversation thread`);
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

  function ensureThreadBadge(card, side) {
    let badge = byId(`threadBadge${side}`);
    if (badge) return badge;
    badge = createThreadBadge(side);
    const identity = card.querySelector(".agent-identity") || card.querySelector(".agent-topline") || card;
    const title = byId(`labelText${side}`);
    if (title?.parentElement === identity) title.insertAdjacentElement("afterend", badge);
    else identity.appendChild(badge);
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
    for (const spec of [
      [`timerTotal${side}`, "Total 0s", "Total working time for this LLM in the current session"],
      [`timerCurrent${side}`, "Current —", "Current turn timer for this LLM"]
    ]) {
      const timer = document.createElement("span");
      timer.id = spec[0];
      timer.className = "round-timer idle";
      timer.textContent = spec[1];
      timer.title = spec[2];
      timers.appendChild(timer);
    }
    identity.append(timers, createStatusBadge(side));

    const actions = document.createElement("div");
    actions.className = "agent-actions";
    for (const [prefix, text, disabled] of [
      ["newChat", "New chat", false],
      ["resend", "Resend", true],
      ["useLast", "Use last reply", true]
    ]) {
      const button = document.createElement("button");
      button.id = `${prefix}${side}`;
      button.type = "button";
      button.className = "tiny ghost";
      button.textContent = text;
      button.disabled = disabled;
      actions.appendChild(button);
    }
    topline.append(identity, actions);

    const tab = document.createElement("select");
    tab.id = `tab${side}`;
    tab.setAttribute("aria-label", `AI ${side} tab`);
    const job = document.createElement("textarea");
    job.id = `job${side}`;
    job.rows = 3;
    job.placeholder = `AI ${side} job / responsibility`;
    card.append(topline, tab, job);
    return card;
  }

  function attachExtendedListeners(side) {
    if (!new Set(["D", "E"]).has(side)) return;
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
      from.textContent = side;
      from.setAttribute("aria-pressed", "false");
      from.addEventListener("click", () => {
        try { if (typeof setForceSource === "function") setForceSource(side); } catch (_) {}
      });
      fromHost.appendChild(from);
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

  function ensureCards() {
    const team = document.querySelector(".team-section");
    const relayPanel = document.querySelector(".manual-relay-panel");
    if (!team || !relayPanel) return false;
    for (const side of ["A", "B", "C"]) {
      const card = document.querySelector(`.agent-${side.toLowerCase()}`);
      if (!card) continue;
      card.dataset.side = side;
      cardCache.set(side, card);
      ensureThreadBadge(card, side);
      ensureHealthBadge(card, side);
    }
    for (const side of ["D", "E"]) {
      let card = cardCache.get(side) || document.querySelector(`.agent-${side.toLowerCase()}`);
      if (!card) card = createExtendedCard(side);
      cardCache.set(side, card);
      if (!card.isConnected) team.insertBefore(card, relayPanel);
      ensureThreadBadge(card, side);
      ensureManualRelayControls(side);
      attachExtendedListeners(side);
    }
    return true;
  }

  function setVisibility(side, visible) {
    const card = cardCache.get(side);
    if (card) card.hidden = !visible;
    const from = byId(`forceFrom${side}`);
    if (from) from.hidden = !visible;
    const to = byId(`forceTo${side}`);
    if (to?.parentElement) to.parentElement.hidden = !visible;
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
    const heading = document.querySelector(".team-section > .section-heading .muted");
    if (heading) heading.textContent = sides.join(" → ");
    const brand = document.querySelector(".brand-block h1");
    if (brand) brand.textContent = `${sides.length} agents. One workspace.`;
    const runtimeHelp = document.querySelector(".runtime-card .field-help");
    if (runtimeHelp) runtimeHelp.textContent = `Uses the ${sides.length} selected, already-open AI tabs. AI Bridge never opens replacement AI tabs for this action.`;
    const manualHelp = document.querySelector(".manual-relay-panel .field-help");
    if (manualHelp) manualHelp.textContent = `If an AI finished on its tab but the bridge never picked that up, re-read the visible reply and send it to any combination of ${sides.join(", ")}.`;
  }

  function ensureCountControl() {
    if (byId("agentCount")) return;
    const heading = document.querySelector(".team-section > .section-heading");
    if (!heading) return;
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
      const previous = activeCount;
      select.disabled = true;
      try {
        const result = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_SET_AGENT_COUNT", agentCount: Number(select.value) });
        if (!result?.ok) throw new Error(result?.error || "Could not change agent count.");
        renderRoster(result.agentCount);
        try { if (typeof refreshTabs === "function") await refreshTabs(); } catch (_) {}
        await refreshHealth(true);
      } catch (error) {
        renderRoster(previous);
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
    for (const side of ALL_SIDES) setVisibility(side, sides.includes(side));
    updateStartSideOptions(sides);
    updateStaticCopy(sides);
    const select = byId("agentCount");
    if (select) {
      select.value = String(activeCount);
      select.disabled = Boolean(typeof latestState !== "undefined" && latestState?.sessionActive);
    }
    const team = document.querySelector(".team-section");
    if (team) team.dataset.agentCount = String(activeCount);
    try { if (typeof refreshStartLabels === "function") refreshStartLabels(); } catch (_) {}
    return sides;
  }

  function installCloudSettingsAugmenter() {
    try {
      if (typeof collectCloudSettings === "function" && !collectCloudSettings.__aiBridgeDynamic) {
        const baseCollect = collectCloudSettings;
        const wrappedCollect = function dynamicCollectCloudSettings() {
          const data = baseCollect();
          data.agentCount = liveSides().length;
          for (const side of ALL_SIDES) {
            const job = byId(`job${side}`);
            if (job) data[`job${side}`] = String(job.value || "").trim();
          }
          return data;
        };
        wrappedCollect.__aiBridgeDynamic = true;
        collectCloudSettings = wrappedCollect;
      }
      if (typeof applyCloudSettingsToForm === "function" && !applyCloudSettingsToForm.__aiBridgeDynamic) {
        const baseApply = applyCloudSettingsToForm;
        const wrappedApply = function dynamicApplyCloudSettingsToForm(settings) {
          baseApply(settings);
          if (!settings || typeof settings !== "object") return;
          const count = Number(settings.agentCount);
          if (Number.isInteger(count)) renderRoster(count);
          for (const side of ALL_SIDES) {
            const job = byId(`job${side}`);
            if (job && typeof settings[`job${side}`] === "string") job.value = settings[`job${side}`];
          }
        };
        wrappedApply.__aiBridgeDynamic = true;
        applyCloudSettingsToForm = wrappedApply;
      }
    } catch (error) {
      console.error("AI Bridge could not extend cloud settings helpers", error);
    }
  }

  function installSelectedBindingsAugmenter() {
    try {
      if (typeof selectedBindings !== "function" || selectedBindings.__aiBridgeDynamic) return;
      const base = selectedBindings;
      const wrapped = function dynamicSelectedBindings() {
        const data = base();
        for (const side of liveSides()) {
          const job = byId(`job${side}`);
          data[`job${side}`] = String(job?.value || "").trim();
          data[`label${side}`] = String(byId(`labelText${side}`)?.textContent || `AI ${side}`);
        }
        return data;
      };
      wrapped.__aiBridgeDynamic = true;
      selectedBindings = wrapped;
    } catch (error) {
      console.error("AI Bridge could not extend selectedBindings", error);
    }
  }

  function applyHealth(health) {
    lastHealth = health || null;
    const sides = liveSides();
    const familyCounts = new Map();
    for (const side of sides) {
      const providerId = String(health?.bySide?.[side]?.providerId || "");
      if (providerId) familyCounts.set(providerId, (familyCounts.get(providerId) || 0) + 1);
    }

    let hasDuplicateThread = false;
    for (const side of sides) {
      const row = health?.bySide?.[side];
      const status = String(row?.status || "CHECKING");
      const badge = byId(`health${side}`);
      if (badge) {
        badge.dataset.status = status;
        badge.title = String(row?.reason || status);
        const label = badge.querySelector(".status-label");
        if (label) label.textContent = status.replaceAll("_", " ");
      }

      const threadBadge = byId(`threadBadge${side}`);
      if (threadBadge) {
        const text = formatThreadBadgeText(row?.threadPath);
        const duplicatedFamily = row?.providerId && (familyCounts.get(String(row.providerId)) || 0) > 1;
        const show = Boolean(text && (duplicatedFamily || status === "DUPLICATE_THREAD"));
        threadBadge.textContent = show ? text : "";
        threadBadge.title = show ? `Conversation thread ${text}` : "";
        threadBadge.hidden = !show;
      }

      const card = cardCache.get(side);
      if (status === "DUPLICATE_THREAD") {
        hasDuplicateThread = true;
        card?.setAttribute("aria-invalid", "true");
      } else {
        card?.removeAttribute("aria-invalid");
      }
    }

    const start = byId("start");
    if (start) {
      if (hasDuplicateThread) {
        if (!start.dataset.viewpointBlocked) start.dataset.viewpointPreviousDisabled = start.disabled ? "true" : "false";
        start.dataset.viewpointBlocked = "true";
        start.disabled = true;
        start.setAttribute("aria-disabled", "true");
        start.title = "Cannot start relay: multiple agents are bound to the same conversation thread.";
      } else if (start.dataset.viewpointBlocked === "true") {
        const previousDisabled = start.dataset.viewpointPreviousDisabled === "true";
        delete start.dataset.viewpointBlocked;
        delete start.dataset.viewpointPreviousDisabled;
        start.disabled = previousDisabled;
        start.removeAttribute("aria-disabled");
        start.removeAttribute("title");
        try {
          if (typeof updateControls === "function" && typeof latestState !== "undefined" && latestState) updateControls(latestState);
        } catch (_) {}
      }
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
      const blocked = liveSides().filter(side => !lastHealth?.bySide?.[side]?.ready);
      if (!blocked.length) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const duplicateThreads = blocked.filter(side => lastHealth?.bySide?.[side]?.status === "DUPLICATE_THREAD");
      const status = byId("status");
      if (status) {
        status.textContent = duplicateThreads.length
          ? `Cannot start: AI ${duplicateThreads.join(", AI ")} share a conversation thread. Bind each agent to a distinct thread.`
          : `Cannot start: resolve provider health for AI ${blocked.join(", AI ")}.`;
      }
      refreshHealth(true).catch(() => {});
    }, true);
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
    installSelectedBindingsAugmenter();
    installCloudSettingsAugmenter();
    installStartGuard();
    const stateResponse = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_GET_STATE", includeSources: false, afterSeq: 0 });
    const bridgeState = stateResponse?.state || null;
    activeCount = Number(bridgeState?.agentCount) || DEFAULT_COUNT;
    renderRoster(activeCount);
    for (const side of liveSides()) {
      const job = byId(`job${side}`);
      if (job && typeof bridgeState?.[`job${side}`] === "string") job.value = bridgeState[`job${side}`];
      const label = byId(`labelText${side}`);
      if (label) label.textContent = String(bridgeState?.[`label${side}`] || `AI ${side}`);
    }
    try { if (typeof refreshTabs === "function") await refreshTabs(); } catch (_) {}
    await refreshHealth(true);
    healthTimer = setInterval(() => refreshHealth(false).catch(() => {}), HEALTH_POLL_MS);
    window.__AI_BRIDGE_DYNAMIC_DASHBOARD_V1__ = Object.freeze({
      version: 1,
      maxAgents: ALL_SIDES.length,
      duplicateProviderAgentsEnabled: false,
      threadBadges: true,
      duplicateThreadStartBlock: true,
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
