(() => {
  "use strict";

  const ALL_SIDES = Object.freeze(["A", "B", "C", "D", "E"]);
  const POLL_MS = 1500;
  let timer = null;

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

  function clearBadge(side) {
    const badge = ensureBadge(side);
    if (!badge) return;
    badge.textContent = "";
    badge.title = "";
    badge.dataset.phase = "idle";
    badge.hidden = true;
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
      badge.dataset.phase = phase;
      if (phase === "queued") {
        const position = Math.max(1, Number(row.queuePosition) || 1);
        const waitSeconds = Math.max(0, Math.floor((Number(row.waitMs) || 0) / 1000));
        badge.textContent = position > 1 ? `Queued #${position}` : "Queued";
        badge.title = waitSeconds > 0 ? `Waiting for provider lock · ${waitSeconds}s` : "Waiting for provider lock";
        badge.hidden = false;
      } else if (phase === "sending") {
        badge.textContent = "Sending";
        badge.title = "This provider-family queue currently owns the send lock.";
        badge.hidden = false;
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

  function start() {
    if (timer) return;
    refreshQueueStatus().catch(() => {});
    timer = setInterval(() => refreshQueueStatus().catch(() => {}), POLL_MS);
    window.addEventListener("pagehide", () => {
      if (timer) clearInterval(timer);
      timer = null;
    }, { once: true });
  }

  window.__AI_BRIDGE_VIEWPOINT_QUEUE_DASHBOARD_V1__ = Object.freeze({
    version: 1,
    exposesSensitiveIdentity: false,
    usesAriaLive: true,
    pollMs: POLL_MS,
    refreshQueueStatus
  });

  start();
})();
