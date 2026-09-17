(() => {
  "use strict";

  // Defense-in-depth for START. The dashboard already disables Start whenever
  // any active provider is not READY, but the service worker must not rely on a
  // disabled button as an authorization/safety boundary. Wrap the existing
  // dynamic binding/reset helpers so a fresh session receives an authoritative
  // forced Provider Health probe before state.running can become true or any
  // prompt can be dispatched.
  const FLAG = "__AI_BRIDGE_START_PROVIDER_HEALTH_GATE_V1__";
  if (globalThis[FLAG]) return;

  if (typeof probeActiveAgents !== "function") {
    throw new Error("Backend start health gate requires Provider Health.");
  }
  if (typeof bindTabsFromMessage !== "function" || typeof resetSelectedChats !== "function") {
    throw new Error("Backend start health gate requires coordinator binding helpers.");
  }

  const baseBindTabsFromMessage = bindTabsFromMessage;
  const baseResetSelectedChats = resetSelectedChats;

  function currentState() {
    try {
      if (typeof state !== "undefined" && state) return state;
    } catch (_) {}
    return globalThis.state || null;
  }

  function isFreshStartBoundary() {
    const current = currentState();
    return Boolean(
      current &&
      current.sessionActive === true &&
      current.running === false &&
      current.paused !== true
    );
  }

  function blockedSummary(snapshot) {
    const sides = Array.isArray(snapshot?.sides) ? snapshot.sides : [];
    return sides
      .filter(side => snapshot?.bySide?.[side]?.ready !== true)
      .map(side => {
        const status = String(snapshot?.bySide?.[side]?.status || "NOT_READY");
        return `AI ${side} (${status})`;
      });
  }

  async function assertFreshStartProvidersReady() {
    const snapshot = await probeActiveAgents({ force: true });
    const blocked = blockedSummary(snapshot);
    if (blocked.length) {
      throw new Error(`Cannot start relay: provider health is not READY for ${blocked.join(", ")}.`);
    }
    return snapshot;
  }

  bindTabsFromMessage = async function healthGatedBindTabsFromMessage(msg) {
    const result = await baseBindTabsFromMessage.apply(this, arguments);

    // START with freshChats=true intentionally navigates the selected tabs after
    // binding. Probe only after that reset so the health decision describes the
    // conversations that will actually receive the first prompt.
    if (isFreshStartBoundary() && msg?.freshChats !== true) {
      await assertFreshStartProvidersReady();
    }
    return result;
  };

  resetSelectedChats = async function healthGatedResetSelectedChats(msg, sides, options = {}) {
    const result = await baseResetSelectedChats.apply(this, arguments);
    if (isFreshStartBoundary() && options?.allowActive === true) {
      await assertFreshStartProvidersReady();
    }
    return result;
  };

  globalThis.assertFreshStartProvidersReady = assertFreshStartProvidersReady;
  globalThis[FLAG] = Object.freeze({
    version: 1,
    backendStartRequiresReadyProviders: true,
    probesAfterFreshChatReset: true,
    doesNotSendProviderPrompts: true,
    assertFreshStartProvidersReady
  });
})();