(() => {
  "use strict";

  const ALL_SIDES = Object.freeze(["A", "B", "C", "D", "E"]);
  let observer = null;
  let refreshScheduled = false;

  const byId = id => document.getElementById(id);

  function ensureBadge(side) {
    let badge = byId(`queueBadge${side}`);
    if (badge) return badge;
    const card = document.querySelector(`.agent-${side.toLowerCase()}`);
    if (!card) return null;
    const identity = card.querySelector(".agent-identity") || card.querySelector(".agent-topline") || card;
    badge = document.createElement("span");
    badge.id = `queueBadge${side}`;
    badge.className = "agent-card-queue-badge";
    badge.hidden = true;
    badge.setAttribute("role", "status");
    badge.setAttribute("aria-live", "polite");
    badge.setAttribute("aria-atomic", "true");
    identity.appendChild(badge);
    return badge;
  }

  function setBadgeState(badge, { text, title, phase, hidden }) {
    if (!badge) return;
    // Each queue badge is a polite live region. Avoid rewriting unchanged text
    // on every Provider Health cadence tick: some assistive technologies may
    // announce a live-region mutation even when the resulting string is the
    // same. Only genuine queue-state changes should mutate the live text.
    if (badge.textContent !== text) badge.textContent = text;
    if (badge.title !== title) badge.title = title;
    if (badge.dataset.phase !== phase) badge.dataset.phase = phase;
    if (badge.hidden !== hidden) badge.hidden = hidden;
  }

  function clearBadge(side) {
    const badge = ensureBadge(side);
    setBadgeState(badge, { text: "", title: "", phase: "idle", hidden: true });
  }

  function applyQueueSnapshot(snapshot) {
    for (const side of ALL_SIDES) {
      const row = snapshot?.bySide?.[side] || null;
      const badge = ensureBadge(side);
      if (!badge || !row) {
        clearBadge(side);
        continue;
      }
      const phase = String(row.phase || "");
      if (phase === "queued") {
        const position = Math.max(1, Number(row.queuePosition) || 1);
        const waitSeconds = Math.max(0, Math.floor((Number(row.waitMs) || 0) / 1000));
        setBadgeState(badge, {
          text: position > 1 ? `Queued #${position}` : "Queued",
          title: waitSeconds > 0 ? `Waiting for provider lock · ${waitSeconds}s` : "Waiting for provider lock",
          phase,
          hidden: false
        });
      } else if (phase === "sending") {
        setBadgeState(badge, {
          text: "Sending",
          title: "This provider-family queue currently owns the send lock.",
          phase,
          hidden: false
        });
      } else {
        clearBadge(side);
      }
    }
  }

  async function refreshQueueStatus() {
    if (document.hidden) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: "AI_BRIDGE_VIEWPOINT_QUEUE_STATUS" });
      if (!response?.ok) throw new Error(response?.error || "Queue status unavailable.");
      applyQueueSnapshot(response.queue);
    } catch (_) {
      for (const side of ALL_SIDES) clearBadge(side);
    }
  }

  function scheduleRefresh() {
    if (refreshScheduled) return;
    refreshScheduled = true;
    queueMicrotask(() => {
      refreshScheduled = false;
      refreshQueueStatus().catch(() => {});
    });
  }

  function start() {
    // Piggyback on the existing health/adaptive refresh cadence instead of
    // creating a second timer. refreshHealth() rewrites this recommendation on
    // every health poll, so one MutationObserver yields one coalesced queue read
    // per existing dashboard cycle.
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

  window.__AI_BRIDGE_VIEWPOINT_QUEUE_DASHBOARD_V1__ = Object.freeze({
    version: 1,
    exposesSensitiveIdentity: false,
    usesAriaLive: true,
    deduplicatesLiveText: true,
    reusesHealthCadence: true,
    independentTimer: false,
    refreshQueueStatus
  });

  start();
})();
