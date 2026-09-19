(() => {
  "use strict";

  // Event-driven dashboard refresh for Provider Health.
  //
  // The dashboard already polls health every 1.5 seconds. This adapter does not
  // replace that safety net and does not duplicate Provider Health logic. It
  // watches browser lifecycle events for tabs currently bound to live logical
  // agents and asks the existing dynamic dashboard adapter to perform one
  // authoritative forced health refresh. Bursts are coalesced so a navigation
  // sequence (loading + url update) cannot create a refresh storm.
  const FLAG = "__AI_BRIDGE_DASHBOARD_HEALTH_LIVE_REFRESH_V1__";
  if (window[FLAG]) return;

  const SIDES = Object.freeze(["A", "B", "C", "D", "E"]);
  const DEFAULT_AGENT_COUNT = 3;
  const COALESCE_MS = 40;
  let refreshTimer = null;

  const byId = id => document.getElementById(id);

  function liveAgentCount() {
    const raw = Number(byId("agentCount")?.value);
    if (!Number.isInteger(raw)) return DEFAULT_AGENT_COUNT;
    return Math.max(1, Math.min(SIDES.length, raw));
  }

  function boundTabIds() {
    const ids = new Set();
    for (const side of SIDES.slice(0, liveAgentCount())) {
      const value = Number(byId(`tab${side}`)?.value);
      if (Number.isInteger(value) && value > 0) ids.add(value);
    }
    return ids;
  }

  function isBoundTab(tabId) {
    const id = Number(tabId);
    return Number.isInteger(id) && id > 0 && boundTabIds().has(id);
  }

  function scheduleAuthoritativeRefresh() {
    if (refreshTimer !== null) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      const dashboard = window.__AI_BRIDGE_DYNAMIC_DASHBOARD_V1__;
      if (!dashboard || typeof dashboard.refreshHealth !== "function") return;
      Promise.resolve(dashboard.refreshHealth(true)).catch(() => {});
    }, COALESCE_MS);
  }

  if (chrome?.tabs?.onUpdated?.addListener) {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      const lifecycleChange = Boolean(
        changeInfo &&
        (Object.prototype.hasOwnProperty.call(changeInfo, "url") || changeInfo.status === "loading")
      );
      if (lifecycleChange && isBoundTab(tabId)) scheduleAuthoritativeRefresh();
    });
  }

  if (chrome?.tabs?.onRemoved?.addListener) {
    chrome.tabs.onRemoved.addListener(tabId => {
      if (isBoundTab(tabId)) scheduleAuthoritativeRefresh();
    });
  }

  if (chrome?.tabs?.onReplaced?.addListener) {
    chrome.tabs.onReplaced.addListener((_addedTabId, removedTabId) => {
      if (isBoundTab(removedTabId)) scheduleAuthoritativeRefresh();
    });
  }

  window[FLAG] = Object.freeze({
    version: 1,
    boundTabLifecycleRefresh: true,
    authoritativeReprobe: true,
    coalescedRefresh: true
  });
})();
