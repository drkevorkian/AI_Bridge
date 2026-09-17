(() => {
  "use strict";

  // Adaptive Selector Probe + Provider Health Monitor.
  //
  // Read-only control-plane service. It never types into a provider composer
  // and never changes currentSide / startSide on its own. Dashboard factories
  // consume the snapshot; Adaptive Selector only *recommends* a READY side.
  const FLAG = "__AI_BRIDGE_PROVIDER_HEALTH_V1__";
  if (globalThis[FLAG]) return;

  const caps = globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__;
  const dynamic = globalThis.__AI_BRIDGE_DYNAMIC_AGENTS_V1__;
  if (!caps || caps.version !== 1) {
    throw new Error("Provider health requires the agent capability contract.");
  }
  if (!dynamic || dynamic.version !== 1 || dynamic.uniqueTabBinding !== true) {
    throw new Error("Provider health requires the dynamic-agent coordinator.");
  }

  const STATUSES = Object.freeze([
    "UNASSIGNED",
    "MISSING_TAB",
    "UNSUPPORTED",
    "DUPLICATE_TAB",
    "DUPLICATE_PROVIDER",
    "DUPLICATE_THREAD",
    "UNREACHABLE",
    "READY",
    "GENERATING"
  ]);

  const MIN_PROBE_INTERVAL_MS = 750;
  const MAX_STABILITY_RETRIES = 2;
  let lastProbeAt = 0;
  let lastSnapshot = null;
  let lastStateKey = "";
  let probeInvalidationEpoch = 0;

  function liveState() {
    try {
      if (typeof state !== "undefined" && state) return state;
    } catch (_) {}
    return globalThis.state || {};
  }

  function liveSides() {
    if (typeof dynamic.liveSides === "function") return [...dynamic.liveSides()];
    const count = caps.normalizeAgentCount(liveState().agentCount);
    return [...caps.sideIdsForCount(count)];
  }

  function tabIdFor(side, current) {
    const raw = current[`tab${side}`];
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  // The short probe cache is safe only while all coordinator fields that can
  // change READY/blocked classification remain identical. This keeps the 750ms
  // de-duplication optimization without allowing a just-started generation,
  // roster resize, or tab rebind to inherit an older READY snapshot.
  function healthStateKey(current, sides) {
    return JSON.stringify([
      Boolean(current?.sessionActive),
      Boolean(current?.running),
      ...sides.map(side => [
        side,
        tabIdFor(side, current),
        Boolean(current?.generationIdBySide?.[side])
      ])
    ]);
  }

  function clearProbeCache() {
    lastProbeAt = 0;
    lastSnapshot = null;
    lastStateKey = "";
    probeInvalidationEpoch += 1;
  }

  function boundTabIds() {
    const current = liveState();
    const ids = new Set();
    for (const side of liveSides()) {
      const tabId = tabIdFor(side, current);
      if (tabId) ids.add(tabId);
    }
    return ids;
  }

  // Coordinator state does not change when the browser independently navigates,
  // reloads, removes, or replaces a bound tab. Invalidate the short health cache
  // on those lifecycle transitions so a previously READY tab cannot remain READY
  // after it has left a trusted provider or disappeared from Chrome.
  function invalidateForBoundTab(tabId) {
    const id = Number(tabId);
    if (!Number.isInteger(id) || id <= 0 || !boundTabIds().has(id)) return false;
    clearProbeCache();
    return true;
  }

  function threadPathForIdentity(identity) {
    const key = String(identity?.threadKey || "");
    if (!key) return null;
    try {
      const parsed = new URL(key);
      return parsed.pathname || "/";
    } catch (_) {
      return null;
    }
  }

  function emptyReport(side, current, extras) {
    return {
      side,
      label: String(current[`label${side}`] || `AI ${side}`),
      tabId: tabIdFor(side, current),
      status: "UNASSIGNED",
      providerId: null,
      providerName: null,
      threadKey: null,
      threadPath: null,
      reachable: false,
      ready: false,
      checkedAt: Date.now(),
      reason: "No supported tab is bound to this agent.",
      ...extras
    };
  }

  async function readTab(tabId) {
    try {
      return await chrome.tabs.get(tabId);
    } catch (_) {
      return null;
    }
  }

  async function pingTab(tabId) {
    if (!chrome?.tabs?.sendMessage) return false;
    try {
      const pong = await chrome.tabs.sendMessage(tabId, { type: "AI_BRIDGE_PING" });
      return Boolean(pong && (pong.ok === true || pong.type === "AI_BRIDGE_PONG" || pong.pong === true));
    } catch (_) {
      return false;
    }
  }

  function classifyDuplicates(drafts) {
    const byTab = new Map();
    const byFamily = new Map();
    const byThread = new Map();
    for (const row of drafts) {
      if (row.tabId) {
        const list = byTab.get(row.tabId) || [];
        list.push(row.side);
        byTab.set(row.tabId, list);
      }
      if (row.providerId) {
        const list = byFamily.get(row.providerId) || [];
        list.push(row.side);
        byFamily.set(row.providerId, list);
      }
      if (row.providerId && row.threadKey) {
        const key = `${row.providerId}::${row.threadKey}`;
        const list = byThread.get(key) || [];
        list.push(row.side);
        byThread.set(key, list);
      }
    }
    return { byTab, byFamily, byThread };
  }

  async function probeSide(side, current) {
    const tabId = tabIdFor(side, current);
    if (!tabId) return emptyReport(side, current);

    const tab = await readTab(tabId);
    if (!tab) {
      return emptyReport(side, current, {
        tabId,
        status: "MISSING_TAB",
        reason: "The bound tab is no longer available."
      });
    }

    const family = caps.providerFamilyForUrl(tab.url || "");
    if (!family) {
      return emptyReport(side, current, {
        tabId,
        status: "UNSUPPORTED",
        reason: "The bound tab is not a trusted HTTPS AI provider."
      });
    }

    const identity = typeof caps.conversationIdentity === "function"
      ? caps.conversationIdentity({ side, tabId, url: tab.url || "" })
      : null;
    const threadKey = identity?.threadKey || null;
    const threadPath = threadPathForIdentity(identity);

    const reachable = await pingTab(tabId);
    if (!reachable) {
      return emptyReport(side, current, {
        tabId,
        status: "UNREACHABLE",
        providerId: family.id,
        providerName: family.name,
        threadKey,
        threadPath,
        reason: "The provider page did not answer the Bridge ping."
      });
    }

    return {
      side,
      label: String(current[`label${side}`] || `AI ${side}`),
      tabId,
      status: "READY",
      providerId: family.id,
      providerName: family.name,
      threadKey,
      threadPath,
      reachable: true,
      ready: true,
      checkedAt: Date.now(),
      reason: `${family.name} tab is bound and reachable.`
    };
  }

  function applyDuplicatePolicy(rows) {
    const { byTab, byFamily, byThread } = classifyDuplicates(rows);
    return rows.map(row => {
      if (row.tabId && (byTab.get(row.tabId) || []).length > 1) {
        return {
          ...row,
          status: "DUPLICATE_TAB",
          ready: false,
          reachable: false,
          reason: "This browser tab is bound to more than one logical agent."
        };
      }
      if (
        caps.duplicateProviderAgentsEnabled !== true &&
        row.providerId &&
        (byFamily.get(row.providerId) || []).length > 1
      ) {
        return {
          ...row,
          status: "DUPLICATE_PROVIDER",
          ready: false,
          reason: "Duplicate-provider agents are disabled until multi-tab viewpoint mode is reviewed."
        };
      }
      if (
        caps.duplicateProviderAgentsEnabled === true &&
        row.providerId &&
        row.threadKey &&
        (byThread.get(`${row.providerId}::${row.threadKey}`) || []).length > 1
      ) {
        return {
          ...row,
          status: "DUPLICATE_THREAD",
          ready: false,
          reason: "Same-provider viewpoint agents must use distinct conversation threads."
        };
      }
      return row;
    });
  }

  function markGenerating(rows, current) {
    if (!current.sessionActive || !current.running) return rows;
    return rows.map(row => {
      if (!row.ready) return row;
      const generating = Boolean(current.generationIdBySide?.[row.side]);
      if (!generating) return row;
      return {
        ...row,
        status: "GENERATING",
        ready: false,
        reason: `${row.providerName || "Provider"} is currently generating.`
      };
    });
  }

  async function probeActiveAgents({ force = false } = {}) {
    const cacheNow = Date.now();
    const cacheCurrent = liveState();
    const cacheSides = liveSides();
    const cacheStateKey = healthStateKey(cacheCurrent, cacheSides);
    if (
      !force &&
      lastSnapshot &&
      cacheStateKey === lastStateKey &&
      cacheNow - lastProbeAt < MIN_PROBE_INTERVAL_MS
    ) {
      return lastSnapshot;
    }

    for (let attempt = 0; attempt <= MAX_STABILITY_RETRIES; attempt += 1) {
      const startedAt = Date.now();
      const startedEpoch = probeInvalidationEpoch;
      const current = liveState();
      const sides = liveSides();
      const stateKey = healthStateKey(current, sides);
      const raw = [];
      for (const side of sides) {
        raw.push(await probeSide(side, current));
      }
      const rows = markGenerating(applyDuplicatePolicy(raw), current);

      // A health snapshot is useful only if it describes one coherent world.
      // Browser lifecycle events and coordinator mutations may happen while the
      // sequential probe is awaiting tab reads/pings. Never publish a result
      // gathered across two different states; retry from scratch instead.
      const endCurrent = liveState();
      const endSides = liveSides();
      const endStateKey = healthStateKey(endCurrent, endSides);
      const stable = startedEpoch === probeInvalidationEpoch && stateKey === endStateKey;
      if (!stable) {
        clearProbeCache();
        if (attempt < MAX_STABILITY_RETRIES) continue;
        throw new Error("Provider health changed repeatedly during probe; retry when tab and routing state are stable.");
      }

      const snapshot = Object.freeze({
        version: 1,
        checkedAt: startedAt,
        agentCount: sides.length,
        sides: Object.freeze(sides.slice()),
        bySide: Object.freeze(Object.fromEntries(rows.map(row => [row.side, Object.freeze(row)]))),
        readySides: Object.freeze(rows.filter(row => row.ready).map(row => row.side)),
        blockedSides: Object.freeze(rows.filter(row => !row.ready).map(row => row.side)),
        duplicateProviderAgentsEnabled: caps.duplicateProviderAgentsEnabled === true
      });
      lastProbeAt = startedAt;
      lastSnapshot = snapshot;
      lastStateKey = stateKey;
      return snapshot;
    }

    throw new Error("Provider health probe could not reach a stable state.");
  }

  // Internal snapshots intentionally retain tabId and threadKey because duplicate
  // tab/thread classification needs them. Extension pages do not. Build public
  // responses from an explicit allowlist so a future internal field cannot leak
  // across the runtime-message boundary merely because it was added to a row.
  function publicHealthSnapshot(snapshot) {
    const bySide = Object.fromEntries(Object.entries(snapshot?.bySide || {}).map(([side, row]) => [
      side,
      Object.freeze({
        side: String(row?.side || side),
        label: String(row?.label || `AI ${side}`),
        status: String(row?.status || "UNASSIGNED"),
        providerId: row?.providerId == null ? null : String(row.providerId),
        providerName: row?.providerName == null ? null : String(row.providerName),
        threadPath: row?.threadPath == null ? null : String(row.threadPath),
        reachable: Boolean(row?.reachable),
        ready: Boolean(row?.ready),
        checkedAt: Number(row?.checkedAt) || 0,
        reason: String(row?.reason || "")
      })
    ]));
    return Object.freeze({
      version: Number(snapshot?.version) || 1,
      checkedAt: Number(snapshot?.checkedAt) || 0,
      agentCount: Number(snapshot?.agentCount) || 0,
      sides: Object.freeze(Array.from(snapshot?.sides || [], side => String(side))),
      bySide: Object.freeze(bySide),
      readySides: Object.freeze(Array.from(snapshot?.readySides || [], side => String(side))),
      blockedSides: Object.freeze(Array.from(snapshot?.blockedSides || [], side => String(side))),
      duplicateProviderAgentsEnabled: snapshot?.duplicateProviderAgentsEnabled === true
    });
  }

  function recommendStartSide(snapshot, preferred) {
    const health = snapshot || lastSnapshot;
    if (!health) {
      return { side: null, reason: "Health has not been probed yet; no READY agent can be recommended." };
    }
    const preferredSide = String(preferred || "").toUpperCase();
    if (health.readySides.includes(preferredSide)) {
      return { side: preferredSide, reason: `${preferredSide} is READY.` };
    }
    if (health.readySides.length) {
      return { side: health.readySides[0], reason: `${preferredSide || "requested side"} is not READY; using ${health.readySides[0]}.` };
    }
    return { side: null, reason: "No READY agent is available; no start side is recommended." };
  }

  function requireHealthCaller(sender) {
    if (typeof requireExtensionPage === "function") {
      requireExtensionPage(sender, "Read provider health");
      return;
    }
    const prefix = chrome.runtime.getURL("");
    const url = String(sender?.url || "");
    if (!url.startsWith(prefix)) {
      throw new Error("Read provider health is only available from the dashboard or popup.");
    }
  }

  if (chrome?.tabs?.onUpdated?.addListener) {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      const navigated = Boolean(changeInfo && (Object.prototype.hasOwnProperty.call(changeInfo, "url") || changeInfo.status === "loading"));
      if (navigated) invalidateForBoundTab(tabId);
    });
  }

  if (chrome?.tabs?.onRemoved?.addListener) {
    chrome.tabs.onRemoved.addListener(tabId => {
      invalidateForBoundTab(tabId);
    });
  }

  if (chrome?.tabs?.onReplaced?.addListener) {
    chrome.tabs.onReplaced.addListener((_addedTabId, removedTabId) => {
      invalidateForBoundTab(removedTabId);
    });
  }

  if (chrome?.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || (msg.type !== "AI_BRIDGE_PROVIDER_HEALTH" && msg.type !== "AI_BRIDGE_ADAPTIVE_SELECT")) return;
      Promise.resolve()
        .then(async () => {
          requireHealthCaller(sender);
          const snapshot = await probeActiveAgents({ force: msg.force === true });
          const publicHealth = publicHealthSnapshot(snapshot);
          if (msg.type === "AI_BRIDGE_ADAPTIVE_SELECT") {
            return { ok: true, health: publicHealth, recommendation: recommendStartSide(snapshot, msg.preferredSide || liveState().startSide) };
          }
          return { ok: true, health: publicHealth };
        })
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
      return true;
    });
  }

  globalThis.probeActiveAgents = probeActiveAgents;
  globalThis.recommendStartSide = recommendStartSide;
  globalThis[FLAG] = Object.freeze({
    version: 1,
    statuses: STATUSES,
    uniqueTabBinding: true,
    includesSanitizedThreadIdentity: true,
    detectsDuplicateThreads: true,
    stateKeyedProbeCache: true,
    tabLifecycleInvalidatesProbeCache: true,
    rejectsUnstableInflightProbes: true,
    publicHealthRedactsSensitiveIdentity: true,
    mutatesRouting: false,
    sendsProviderPrompts: false,
    probeActiveAgents,
    recommendStartSide
  });
})();
