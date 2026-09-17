(() => {
  "use strict";

  // Replace leftover 3-agent wording and budgets with live-roster semantics.
  // Does not change routing. Existing A/B/C behavior is the default roster.
  const FLAG = "__AI_BRIDGE_DYNAMIC_SEMANTICS_V1__";
  if (globalThis[FLAG]) return;

  const caps = globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__;
  const dynamic = globalThis.__AI_BRIDGE_DYNAMIC_AGENTS_V1__;
  if (!caps || caps.version !== 1 || !dynamic || dynamic.version !== 1) {
    throw new Error("Dynamic-agent semantics require the capability contract and coordinator overlay.");
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

  if (typeof sanitizeCloudSettings === "function") {
    const baseSanitize = sanitizeCloudSettings;
    sanitizeCloudSettings = function dynamicSanitizeCloudSettings(raw, options = {}) {
      const next = baseSanitize(raw, options);
      const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
      const parsedCount = caps.parseAgentCount(src.agentCount);
      next.agentCount = parsedCount === null ? caps.defaultAgentCount : parsedCount;
      const storedSides = [...caps.sideIdsForCount(next.agentCount)];
      const requestedStart = String(src.startSide || next.startSide || "A").toUpperCase();
      next.startSide = storedSides.includes(requestedStart) ? requestedStart : storedSides[0];
      for (const side of ALL_JOB_SIDES) {
        next[`job${side}`] = String(src[`job${side}`] || next[`job${side}`] || "").trim().slice(0, 4000);
      }
      return next;
    };
  }

  if (typeof applyIdleCloudSettings === "function") {
    const baseApply = applyIdleCloudSettings;
    applyIdleCloudSettings = async function dynamicApplyIdleCloudSettings(settings) {
      await baseApply(settings);
      for (const side of ALL_JOB_SIDES) {
        if (typeof settings?.[`job${side}`] === "string") {
          state[`job${side}`] = String(settings[`job${side}`]).trim().slice(0, 4000);
        }
      }
      if (settings && Object.prototype.hasOwnProperty.call(settings, "agentCount") && typeof applyAgentCount === "function") {
        try {
          await applyAgentCount(settings.agentCount, { persist: false });
        } catch (_) {
          // Leave the current idle roster if the stored count is invalid.
        }
      }
      const sides = liveSides();
      const start = String(settings?.startSide || "").toUpperCase();
      if (sides.includes(start)) {
        state.startSide = start;
        state.mainSide = start;
      }
      if (typeof saveState === "function") await saveState();
    };
  }

  globalThis[FLAG] = Object.freeze({
    version: 1,
    liveRosterPrompts: true,
    derivedTurnMinimums: true,
    cloudJobsThroughE: true
  });
})();
