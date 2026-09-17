(() => {
  "use strict";

  // Same-provider viewpoint runtime. Conversation identity is captured before
  // provider dispatch, stamped into response transcript entries during the
  // normal commit, and duplicated provider families share a deterministic send
  // queue. Viewpoint mode always fails closed without trusted dispatch identity.
  const FLAG = "__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__";
  if (globalThis[FLAG]) return;

  const caps = globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__;
  if (!caps || caps.version !== 1 || typeof caps.conversationIdentity !== "function" || typeof caps.sameFamilySendPlan !== "function") {
    throw new Error("Viewpoint runtime requires the conversation-identity contract.");
  }
  if (caps.duplicateProviderAgentsEnabled !== true) {
    throw new Error("Viewpoint runtime activation requires duplicate-provider mode.");
  }

  const familyQueues = new Map();
  const queueMetrics = new Map();
  let queueSequence = 1;

  function liveSides() {
    const dynamic = globalThis.__AI_BRIDGE_DYNAMIC_AGENTS_V1__;
    if (typeof dynamic?.liveSides === "function") return [...dynamic.liveSides()];
    return Array.isArray(SIDES) && SIDES.length ? [...SIDES] : ["A", "B", "C"];
  }

  async function tabUrl(tabId) {
    if (!Number.isInteger(Number(tabId)) || Number(tabId) <= 0) return "";
    try {
      const tab = await chrome.tabs.get(Number(tabId));
      return String(tab?.url || "");
    } catch (_) {
      return "";
    }
  }

  async function identityForSide(side) {
    const tabId = typeof tabForSide === "function" ? Number(tabForSide(side)) : 0;
    return caps.conversationIdentity({ side, tabId, url: await tabUrl(tabId) });
  }

  function sanitizedIdentity(identity) {
    if (!identity) return null;
    return {
      provenanceId: String(identity.provenanceId || ""),
      threadKey: String(identity.threadKey || ""),
      providerFamily: String(identity.familyId || ""),
      boundTabId: Number(identity.tabId) || null
    };
  }

  function requireDispatchIdentity(identity) {
    if (!identity) {
      throw new Error("Viewpoint dispatch requires a trusted conversation identity.");
    }
    return identity;
  }

  function sameIdentity(left, right) {
    if (!left || !right) return false;
    return left.provenanceId === right.provenanceId &&
      left.threadKey === right.threadKey &&
      left.providerFamily === right.providerFamily &&
      left.boundTabId === right.boundTabId;
  }

  function rememberIdentity(side, identity) {
    const safe = sanitizedIdentity(identity);
    state.viewpointIdentityBySide = {
      ...(state.viewpointIdentityBySide && typeof state.viewpointIdentityBySide === "object" ? state.viewpointIdentityBySide : {}),
      [side]: safe
    };
    return safe;
  }

  function stampEntry(entry, identity) {
    if (!entry || typeof entry !== "object" || !identity) return entry;
    entry.provenanceId = identity.provenanceId;
    entry.threadKey = identity.threadKey;
    entry.providerFamily = identity.providerFamily;
    entry.boundTabId = identity.boundTabId;
    return entry;
  }

  async function currentAssignments() {
    const rows = [];
    for (const side of liveSides()) {
      const tabId = typeof tabForSide === "function" ? Number(tabForSide(side)) : 0;
      rows.push({ side, tabId, url: await tabUrl(tabId) });
    }
    return rows;
  }

  function validateAssignments(assignments) {
    const verdict = caps.evaluateAgentBindings(assignments, {
      duplicateProviderAgentsEnabled: true
    });
    if (!verdict.ok) {
      throw new Error(verdict.errors[0]?.message || "Viewpoint binding policy rejected this send.");
    }
    return verdict;
  }

  function metricForFamily(familyId) {
    const key = familyId || "unknown";
    let metric = queueMetrics.get(key);
    if (!metric) {
      metric = {
        familyId: key,
        pending: [],
        activeSide: null,
        activeStartedAt: 0,
        totalEnqueued: 0,
        totalCompleted: 0,
        totalRejected: 0,
        maxDepth: 0,
        totalWaitMs: 0,
        lastWaitMs: 0
      };
      queueMetrics.set(key, metric);
    }
    return metric;
  }

  function queueSnapshot() {
    const now = Date.now();
    const byFamily = {};
    const bySide = {};
    for (const [familyId, metric] of queueMetrics.entries()) {
      const waiting = metric.pending.length;
      const active = Boolean(metric.activeSide);
      byFamily[familyId] = {
        waiting,
        active,
        depth: waiting + (active ? 1 : 0),
        activeSide: metric.activeSide || null,
        totalEnqueued: metric.totalEnqueued,
        totalCompleted: metric.totalCompleted,
        totalRejected: metric.totalRejected,
        maxDepth: metric.maxDepth,
        lastWaitMs: metric.lastWaitMs,
        averageWaitMs: metric.totalCompleted + metric.totalRejected > 0
          ? Math.round(metric.totalWaitMs / (metric.totalCompleted + metric.totalRejected))
          : 0
      };
      if (metric.activeSide) {
        bySide[metric.activeSide] = {
          phase: "sending",
          familyId,
          queuePosition: 0,
          waitMs: 0,
          activeMs: Math.max(0, now - metric.activeStartedAt)
        };
      }
      metric.pending.forEach((entry, index) => {
        bySide[entry.side] = {
          phase: "queued",
          familyId,
          queuePosition: index + 1,
          waitMs: Math.max(0, now - entry.enqueuedAt),
          activeMs: 0
        };
      });
    }
    return {
      capturedAt: now,
      byFamily,
      bySide
    };
  }

  function cancelQueuedForTab(tabId) {
    const closedTabId = Number(tabId);
    if (!Number.isInteger(closedTabId) || closedTabId <= 0) return 0;
    let cancelled = 0;
    for (const metric of queueMetrics.values()) {
      for (const entry of [...metric.pending]) {
        if (entry.boundTabId !== closedTabId || entry.cancelled) continue;
        entry.cancelled = true;
        const pendingIndex = metric.pending.findIndex(item => item.id === entry.id);
        if (pendingIndex >= 0) metric.pending.splice(pendingIndex, 1);
        metric.totalRejected += 1;
        cancelled += 1;
        entry.rejectCancellation?.(new Error("Viewpoint target tab closed while queued; refusing dispatch."));
      }
    }
    return cancelled;
  }

  function enqueueFamily(familyId, side, boundTabId, work) {
    const key = familyId || "unknown";
    const metric = metricForFamily(key);
    let rejectCancellation = null;
    const cancellation = new Promise((_, reject) => {
      rejectCancellation = reject;
    });
    const entry = {
      id: queueSequence++,
      side,
      boundTabId: Number(boundTabId) || null,
      enqueuedAt: Date.now(),
      cancelled: false,
      rejectCancellation
    };
    metric.pending.push(entry);
    metric.totalEnqueued += 1;
    metric.maxDepth = Math.max(metric.maxDepth, metric.pending.length + (metric.activeSide ? 1 : 0));

    const previous = familyQueues.get(key) || Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      const pendingIndex = metric.pending.findIndex(item => item.id === entry.id);
      if (pendingIndex >= 0) metric.pending.splice(pendingIndex, 1);
      if (entry.cancelled) return undefined;

      const startedAt = Date.now();
      const waitMs = Math.max(0, startedAt - entry.enqueuedAt);
      metric.activeSide = side;
      metric.activeStartedAt = startedAt;
      metric.lastWaitMs = waitMs;
      metric.totalWaitMs += waitMs;
      try {
        const result = await work();
        metric.totalCompleted += 1;
        return result;
      } catch (error) {
        metric.totalRejected += 1;
        throw error;
      } finally {
        metric.activeSide = null;
        metric.activeStartedAt = 0;
      }
    });
    familyQueues.set(key, next);
    next.finally(() => {
      if (familyQueues.get(key) === next) familyQueues.delete(key);
    }).catch(() => {});

    // The serialized internal chain must remain intact even when a tab closes,
    // but callers should learn about a cancelled queued send immediately. The
    // race rejects at tab-removal time while `next` later skips the cancelled
    // entry without calling the provider or double-counting the rejection.
    return Promise.race([next, cancellation]);
  }

  function requireQueueStatusCaller(sender) {
    if (typeof requireExtensionPage === "function") {
      requireExtensionPage(sender, "Viewpoint queue status");
      return;
    }
    const extensionRoot = typeof chrome?.runtime?.getURL === "function" ? chrome.runtime.getURL("") : "";
    const senderUrl = String(sender?.url || "");
    if (!extensionRoot || !senderUrl.startsWith(extensionRoot)) {
      throw new Error("Viewpoint queue status is only available from an extension page.");
    }
  }

  if (typeof recordTranscript === "function") {
    const baseRecordTranscript = recordTranscript;
    recordTranscript = function viewpointRecordTranscript(type, payload = {}) {
      const entry = baseRecordTranscript(type, payload);
      if (type === "response" && payload?.side) {
        const identity = state?.viewpointIdentityBySide?.[payload.side] || null;
        if (identity) stampEntry(entry, identity);
      }
      return entry;
    };
  }

  if (typeof sendToSide === "function") {
    const baseSend = sendToSide;
    sendToSide = async function viewpointSendToSide(side, text, options) {
      // First snapshot establishes the user's intended tab/thread and determines
      // whether this provider family needs serialization. This is not enough by
      // itself: a queued tab may navigate while another same-family send runs.
      const assignments = await currentAssignments();
      validateAssignments(assignments);
      const plan = caps.sameFamilySendPlan(assignments);
      const row = assignments.find(item => item.side === side) || null;
      const initialRawIdentity = row ? caps.conversationIdentity(row) : await identityForSide(side);
      const intendedIdentity = sanitizedIdentity(requireDispatchIdentity(initialRawIdentity));
      const familyId = intendedIdentity.providerFamily;
      const queue = plan.queues.find(item => item.familyId === familyId);

      const run = async () => {
        // Re-resolve immediately before provider dispatch. If the side was
        // rebound or its tab navigated while waiting in the family queue, fail
        // closed instead of sending to a different thread with stale provenance.
        const dispatchAssignments = await currentAssignments();
        validateAssignments(dispatchAssignments);
        const dispatchRow = dispatchAssignments.find(item => item.side === side) || null;
        const dispatchRawIdentity = dispatchRow ? caps.conversationIdentity(dispatchRow) : await identityForSide(side);
        const dispatchIdentity = sanitizedIdentity(requireDispatchIdentity(dispatchRawIdentity));
        if (!sameIdentity(intendedIdentity, dispatchIdentity)) {
          throw new Error("Viewpoint binding changed while queued; refusing dispatch to preserve conversation provenance.");
        }

        rememberIdentity(side, dispatchRawIdentity);
        const result = await baseSend(side, text, options);
        if (options?.record === false && typeof saveState === "function") {
          await saveState();
        }
        return result;
      };

      if (caps.serializeSameFamilySends === true && queue?.serialize) {
        return enqueueFamily(familyId, side, intendedIdentity.boundTabId, run);
      }
      return run();
    };
  }

  if (chrome?.tabs?.onRemoved?.addListener) {
    chrome.tabs.onRemoved.addListener(tabId => {
      cancelQueuedForTab(tabId);
    });
  }

  if (chrome?.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.type !== "AI_BRIDGE_VIEWPOINT_QUEUE_STATUS") return undefined;
      Promise.resolve().then(() => {
        requireQueueStatusCaller(sender);
        sendResponse({ ok: true, queue: queueSnapshot() });
      }).catch(error => {
        sendResponse({ ok: false, error: String(error?.message || error) });
      });
      return true;
    });
  }

  globalThis.viewpointIdentityForSide = identityForSide;
  globalThis.requireViewpointDispatchIdentity = requireDispatchIdentity;
  globalThis.getViewpointQueueSnapshot = queueSnapshot;
  globalThis.cancelQueuedViewpointForTab = cancelQueuedForTab;
  globalThis[FLAG] = Object.freeze({
    version: 1,
    stampsTranscript: true,
    stampsBeforeCommitSave: true,
    capturesIdentityBeforeDispatch: true,
    failsClosedWithoutDispatchIdentityWhenEnabled: true,
    serializesSameFamilySends: true,
    validatesBindingsBeforeSend: true,
    revalidatesIdentityAtDispatch: true,
    cancelsQueuedOnTabClose: true,
    restoresQueuedSendsAfterWorkerRestart: false,
    queueTelemetryReadOnly: true,
    queueTelemetryEphemeral: true,
    queueTelemetryContainsSensitiveIdentity: false,
    enablesDuplicateProviders: true
  });
})();
