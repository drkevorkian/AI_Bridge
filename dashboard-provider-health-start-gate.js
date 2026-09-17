(() => {
  "use strict";

  // Keep the Start button's visible state aligned with the fail-closed Provider
  // Health contract without taking ownership away from the legacy session-state
  // controls. This adapter only adds a health gate: it disables Start whenever
  // any active logical agent is not READY. When health becomes fully READY, it
  // releases only its own gate and asks legacy updateControls() to restore the
  // correct session-driven disabled state.
  const FLAG = "__AI_BRIDGE_PROVIDER_HEALTH_START_GATE_V1__";
  if (window[FLAG]) return;

  const SIDES = Object.freeze(["A", "B", "C", "D", "E"]);
  const DEFAULT_AGENT_COUNT = 3;
  const byId = id => document.getElementById(id);

  function liveSides() {
    const raw = Number(byId("agentCount")?.value);
    const count = Number.isInteger(raw)
      ? Math.max(1, Math.min(SIDES.length, raw))
      : DEFAULT_AGENT_COUNT;
    return SIDES.slice(0, count);
  }

  function blockedSides() {
    return liveSides().filter(side => String(byId(`health${side}`)?.dataset?.status || "CHECKING") !== "READY");
  }

  function restoreLegacyStartState(start) {
    try {
      if (typeof updateControls === "function" && typeof latestState !== "undefined" && latestState) {
        updateControls(latestState);
      }
    } catch (_) {}
    if (!start.disabled) start.removeAttribute("aria-disabled");
  }

  function syncStartGate() {
    const start = byId("start");
    if (!start) return false;

    const blocked = blockedSides();
    if (blocked.length) {
      start.dataset.providerHealthBlocked = "true";
      start.disabled = true;
      start.setAttribute("aria-disabled", "true");

      // Do not replace a running-session explanation. While idle, make the
      // health reason explicit so the visible disabled state is actionable.
      const sessionActive = Boolean(typeof latestState !== "undefined" && latestState?.sessionActive);
      if (!sessionActive) {
        start.dataset.providerHealthTitle = "true";
        start.title = `Cannot start relay: provider health is not READY for AI ${blocked.join(", AI ")}.`;
      }
      return true;
    }

    if (start.dataset.providerHealthBlocked === "true") {
      delete start.dataset.providerHealthBlocked;
      if (start.dataset.providerHealthTitle === "true") {
        delete start.dataset.providerHealthTitle;
        start.removeAttribute("title");
      }
      restoreLegacyStartState(start);
    }
    return false;
  }

  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type !== "attributes") continue;
      if (["data-status", "data-agent-count", "disabled"].includes(record.attributeName)) {
        syncStartGate();
        return;
      }
    }
  });

  const root = document.body || document.documentElement;
  if (root) {
    observer.observe(root, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-status", "data-agent-count", "disabled"]
    });
  }

  syncStartGate();

  window[FLAG] = Object.freeze({
    version: 1,
    failClosedStartState: true,
    preservesLegacySessionControl: true,
    syncStartGate
  });
})();
