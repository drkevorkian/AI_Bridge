(() => {
  "use strict";

  // Replace leftover 3-agent wording, budgets, and explicit Mesh side targets
  // with live-roster semantics while preserving the legacy A/B/C defaults.
  const FLAG = "__AI_BRIDGE_DYNAMIC_SEMANTICS_V1__";
  if (globalThis[FLAG]) return;

  const caps = globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__;
  const dynamic = globalThis.__AI_BRIDGE_DYNAMIC_AGENTS_V1__;
  const rosterState = globalThis.__AI_BRIDGE_ROSTER_STATE_ADAPTER_V1__;
  const cloudV2 = globalThis.__AI_BRIDGE_CLOUD_SETTINGS_V2__;
  if (!caps || caps.version !== 1 || !dynamic || dynamic.version !== 1) {
    throw new Error("Dynamic-agent semantics require the capability contract and coordinator overlay.");
  }
  if (!rosterState || rosterState.version !== 1 || typeof rosterState.writeAgent !== "function") {
    throw new Error("Dynamic-agent semantics require the roster-state adapter.");
  }
  if (!cloudV2 || cloudV2.version !== 2 || typeof cloudV2.projectToLegacy !== "function") {
    throw new Error("Dynamic-agent semantics require Cloud Settings V2.");
  }

  function liveSides() {
    if (typeof dynamic.liveSides === "function") return [...dynamic.liveSides()];
    return Array.isArray(SIDES) && SIDES.length ? [...SIDES] : ["A", "B", "C"];
  }

  function liveCount() {
    if (typeof dynamic.liveCount === "function") return dynamic.liveCount();
    return liveSides().length;
  }

  function listPhrase(items) {
    if (!items.length) return "the live team";
    if (items.length === 1) return items[0];
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
  }

  function agentNames(sides = liveSides()) {
    return sides.map(side => `AI ${side}`);
  }

  function otherNames(side) {
    return agentNames(liveSides().filter(item => item !== side));
  }

  function teamNoun(count = liveCount()) {
    return count === 1 ? "1-AI team" : `${count}-AI team`;
  }

  function relayOrder(sides = liveSides()) {
    return sides.join(" → ") || "A";
  }

  const ALL_JOB_SIDES = [...caps.supportedAgentSides];

  if (typeof minimumTurnsForWorkMode === "function") {
    minimumTurnsForWorkMode = function dynamicMinimumTurnsForWorkMode(mode = state.workMode) {
      const count = Math.max(1, liveCount());
      if (mode === "review") return count * 2;
      if (mode === "compete" || mode === "parallel") return count;
      return 1;
    };
  }

  if (typeof teamContext === "function") {
    const baseTeamContext = teamContext;
    teamContext = function dynamicTeamContext(side) {
      const text = baseTeamContext(side);
      const names = listPhrase(agentNames());
      return String(text || "")
        .replace(/in a three-AI team coordinated by AI Bridge\./g, `in a ${teamNoun()} coordinated by AI Bridge.`)
        .replace(/Treat AI A, AI B, and AI C as competitors on the same objective during the primary pass; do not sabotage or misrepresent peer work\./g, `Treat ${names} as competitors on the same objective during the primary pass; do not sabotage or misrepresent peer work.`)
        .replace(/Treat AI A, AI B, and AI C as collaborators on the same objective\./g, `Treat ${names} as collaborators on the same objective.`);
    };
  }

  if (typeof workModeInstruction === "function") {
    const baseWorkModeInstruction = workModeInstruction;
    workModeInstruction = function dynamicWorkModeInstruction(side, phase = state.workPhase) {
      const others = listPhrase(otherNames(side));
      const names = listPhrase(agentNames());
      const count = liveCount();
      return String(baseWorkModeInstruction(side, phase) || "")
        .replace(/You are competing with AI A, AI B, and AI C on the same objective\./g, `You are competing with ${names} on the same objective.`)
        .replace(/independently from the other two AIs\./g, count <= 1 ? "independently." : `independently from ${others}.`)
        .replace(/Work as one member of a dynamically routed three-AI team\./g, `Work as one member of a dynamically routed ${teamNoun()}.`)
        .replace(/Review the other two AIs' primary responses below\./g, count <= 1 ? "Review the available primary responses below." : `Review ${others}' primary responses below.`)
        .replace(/after all three AIs finish this phase\./g, `after all ${count} live AI${count === 1 ? "" : "s"} finish this phase.`)
        .replace(/Work in the normal A → B → C relay\./g, `Work in the normal ${relayOrder()} relay.`);
    };
  }

  if (typeof initialMessage === "function") {
    const baseInitialMessage = initialMessage;
    initialMessage = function dynamicInitialMessage(side) {
      const message = baseInitialMessage(side);
      const others = listPhrase(otherNames(side));
      if (!message || typeof message !== "object") return message;
      return {
        ...message,
        text: String(message.text || "")
          .replace(/for the other two agents to improve\./g, liveCount() <= 1 ? "for later teammates to improve." : `for ${others} to improve.`)
          .replace(/for the next two agents to build on\./g, liveCount() <= 1 ? "for later teammates to build on." : `for ${others} to build on.`)
      };
    };
  }

  // The legacy Direct Mesh parser explicitly matches only [A-C] even though its
  // label-based path already consults the live SIDES array. Intercept only the
  // explicit side token so AI D/E work without replacing custom-label routing.
  if (typeof resolveCommandTarget === "function") {
    const baseResolveCommandTarget = resolveCommandTarget;
    resolveCommandTarget = function dynamicResolveCommandTarget(raw, fromSide = null) {
      const token = typeof normalizeTargetToken === "function"
        ? normalizeTargetToken(raw)
        : String(raw || "").trim().toLowerCase();
      const match = token.match(/(?:^|\b)ai\s*[-:]?\s*([a-e])(?:\b|$)/i) || token.match(/^([a-e])$/i);
      if (match) {
        const side = String(match[1]).toUpperCase();
        const sides = liveSides();
        if (!sides.includes(side) || side === fromSide) return null;
        return side;
      }
      return baseResolveCommandTarget(raw, fromSide);
    };
  }

  if (typeof bridgeCommandProtocolText === "function") {
    const baseBridgeCommandProtocolText = bridgeCommandProtocolText;
    bridgeCommandProtocolText = function dynamicBridgeCommandProtocolText() {
      const text = String(baseBridgeCommandProtocolText() || "");
      if (!text) return text;
      const targets = liveSides().map(side => `SEND TO: AI ${side}`).join("\n");
      return text.replace(/SEND TO: AI A\nSEND TO: AI B\nSEND TO: AI C/g, targets);
    };
  }

  if (typeof requireBoundSessionTab === "function") {
    const baseRequire = requireBoundSessionTab;
    requireBoundSessionTab = function dynamicRequireBoundSessionTab(sender, action) {
      try {
        return baseRequire(sender, action);
      } catch (err) {
        const text = String(err?.message || err);
        if (/AI A\/B\/C tab/.test(text)) {
          throw new Error(`${action} is only allowed from a currently bound live team tab.`);
        }
        throw err;
      }
    };
  }

  if (typeof forceRelayCapturedResponse === "function") {
    const baseForce = forceRelayCapturedResponse;
    forceRelayCapturedResponse = async function dynamicForceRelayCapturedResponse(source, targets) {
      const fromSide = String(source || "").toUpperCase();
      const sides = liveSides();
      if (fromSide && !sides.includes(fromSide)) {
        throw new Error(`Choose a live team AI (${sides.join(", ")}) as the source.`);
      }
      return baseForce(source, targets);
    };
  }

  if (typeof applyIdleCloudSettings === "function") {
    const baseApply = applyIdleCloudSettings;
    applyIdleCloudSettings = async function dynamicApplyIdleCloudSettings(settings) {
      const projected = cloudV2.projectToLegacy(settings);

      // Cloud V2 is already validated. Resize before job writes so the roster
      // shape and every job update commit together, with no inactive-slot write.
      if (typeof applyAgentCount === "function") {
        await applyAgentCount(projected.agentCount, { persist: false });
      }

      await baseApply(settings, { persist: false });
      const active = new Set(liveSides());
      for (const side of ALL_JOB_SIDES) {
        if (!active.has(side)) continue;
        rosterState.writeAgent(state, side, {
          job: String(projected[`job${side}`] || "").trim().slice(0, 4000)
        });
      }

      const sides = liveSides();
      if (sides.includes(projected.startSide)) {
        state.startSide = projected.startSide;
        state.mainSide = projected.startSide;
      }
      if (typeof saveState === "function") await saveState();
    };
  }

  globalThis[FLAG] = Object.freeze({
    version: 2,
    liveRosterPrompts: true,
    liveRosterMeshTargets: true,
    derivedTurnMinimums: true,
    cloudJobsThroughE: true,
    cloudSchemaVersion: 2,
    cloudCanonicalRosterOnly: true,
    cloudImportsSchemaV1: true,
    cloudJobWritesThroughRosterAdapter: true,
    cloudResizesRosterBeforeJobWrites: true,
    cloudSkipsInactiveRosterSlots: true
  });
})();
