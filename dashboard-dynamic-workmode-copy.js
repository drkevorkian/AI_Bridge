(() => {
  "use strict";

  const ALL_SIDES = Object.freeze(["A", "B", "C", "D", "E"]);
  const BATCH_MODES = new Set(["compete", "parallel", "review"]);
  const byId = id => document.getElementById(id);

  function liveSides() {
    const teamCount = Number(document.querySelector(".team-section")?.dataset?.agentCount);
    const selectedCount = Number(byId("agentCount")?.value);
    const count = Number.isInteger(teamCount) && teamCount > 0 ? teamCount : selectedCount;
    const safeCount = Math.max(1, Math.min(ALL_SIDES.length, Number(count) || 3));
    return ALL_SIDES.slice(0, safeCount);
  }

  function aiList(sides) {
    return sides.map(side => `AI ${side}`).join("|");
  }

  function workModeHelp(mode, sides) {
    const route = sides.join(" → ");
    const count = sides.length;
    const selected = count === 1 ? "the selected AI" : `all ${count} selected AIs`;

    switch (mode) {
      case "collaborate":
        return [
          `Timing: sequential ${route}. One AI at a time. Not a live consensus discussion.`,
          "Peer visibility: every later AI sees the accumulated shared deliverable and revises that same artifact.",
          "Cycle: every selected LLM has participated once. The counter ticks only after that full lap of the shared document/design/code.",
          "Main AI: first speaker, and the recipient of queued human interjections.",
          "Best for: writing one final design, spec, or codebase where each specialist improves the same artifact."
        ].join("\n");
      case "compete":
        return [
          `Timing: ${selected} start simultaneously.`,
          "Peer visibility: they do not see each other's answers during the primary pass.",
          "Cycle: the whole simultaneous batch. The counter ticks after every selected LLM has submitted, not after each individual response.",
          "Main AI: still the recipient of queued human interjections; it is not a sequential first speaker in this mode.",
          "Best for: independent solutions, avoiding anchoring, then comparing results."
        ].join("\n");
      case "parallel":
        return [
          `Timing: ${selected} start simultaneously.`,
          "Peer visibility: they work independently on their assigned jobs rather than solving the identical problem multiple times.",
          "Cycle: the whole simultaneous batch. The counter ticks after every selected job has finished.",
          "Main AI: recipient of queued human interjections; all selected AIs still start together.",
          "Best for: work that decomposes into backend / frontend / research / security tracks."
        ].join("\n");
      case "review":
        return [
          `Timing: two simultaneous phases across ${count} selected ${count === 1 ? "AI" : "AIs"}. Selected AIs produce independent primaries first; there is no single drafter.`,
          "Peer visibility: phase 1 is independent. Phase 2 gives each AI the other selected results and requests critique. There is no automatic primary-revision pass after critique.",
          "Cycle: the full primary+critique pass. The counter ticks only after both phases finish.",
          "Main AI: recipient of queued human interjections; it is not a sequential first speaker.",
          "Best for: high-confidence validation and catching mistakes or bias."
        ].join("\n");
      case "mesh":
        return [
          "Timing: one AI at a time.",
          "Peer visibility: the responding AI sees accumulated shared updates, then can choose the next teammate.",
          `Cycle: every selected LLM has participated at least once. Routing the same teammate twice does not complete the cycle. Put SEND TO: ${aiList(sides)} (or an unambiguous label) on the final non-empty line. Without a valid target, normal next-agent routing applies.`,
          "Main AI: first speaker unless a prior handoff changed the cursor, and the recipient of queued human interjections.",
          "Best for: dynamic workflows where the right next specialist depends on what was just discovered."
        ].join("\n");
      case "relay":
      default:
        return [
          `Timing: sequential ${route}. One AI at a time.`,
          "Peer visibility: every later AI sees accumulated shared updates before it responds, and continues the same problem.",
          "Cycle: every selected LLM has participated once. The counter ticks only after that full lap.",
          "Main AI: first speaker, and the recipient of queued human interjections.",
          "Best for: investigations, debugging, and iterative design where each specialist builds on prior work."
        ].join("\n");
    }
  }

  function rewriteLegacyStatusCopy() {
    const status = byId("status");
    if (!status) return;
    const sides = liveSides();
    const count = sides.length;
    const text = String(status.textContent || "");

    if (text === "Starting three-AI session…") {
      status.textContent = `Starting ${count}-AI session…`;
      return;
    }

    const legacyResume = "To resume, bind all three roles to open AI tabs.";
    if (text.includes(legacyResume)) {
      const binding = count === 1 ? "the selected role" : `all ${count} selected roles`;
      const tabs = count === 1 ? "tab" : "tabs";
      status.textContent = text.replace(legacyResume, `To resume, bind ${binding} to open AI ${tabs}.`);
    }
  }

  function refreshDynamicWorkModeCopy() {
    const sides = liveSides();
    const mode = String(byId("workMode")?.value || "relay");
    const help = byId("workModeHelp");
    if (help) help.textContent = workModeHelp(mode, sides);

    const startSide = byId("startSide");
    if (startSide) {
      startSide.title = BATCH_MODES.has(mode)
        ? "All selected AIs start simultaneously; this selection still defines the Main AI for queued human interjections."
        : "Choose the first speaker and Main AI for queued human interjections.";
    }
    rewriteLegacyStatusCopy();
  }

  function install() {
    const workMode = byId("workMode");
    if (workMode && !workMode.dataset.dynamicCopyBound) {
      workMode.dataset.dynamicCopyBound = "true";
      workMode.addEventListener("change", refreshDynamicWorkModeCopy);
    }

    const team = document.querySelector(".team-section");
    if (team && typeof MutationObserver === "function") {
      const observer = new MutationObserver(records => {
        if (records.some(record => record.type === "attributes" && record.attributeName === "data-agent-count")) {
          refreshDynamicWorkModeCopy();
        }
      });
      observer.observe(team, { attributes: true, attributeFilter: ["data-agent-count"] });
    }

    const status = byId("status");
    if (status && typeof MutationObserver === "function") {
      const statusObserver = new MutationObserver(rewriteLegacyStatusCopy);
      statusObserver.observe(status, { childList: true, characterData: true, subtree: true });
    }

    refreshDynamicWorkModeCopy();
  }

  install();

  window.__AI_BRIDGE_DYNAMIC_WORKMODE_COPY__ = Object.freeze({
    version: 2,
    liveRosterCopy: true,
    dynamicSessionStatusCopy: true,
    textOnlyRendering: true,
    refresh: refreshDynamicWorkModeCopy
  });
})();
