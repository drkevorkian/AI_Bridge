(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_ROSTER_UI_PRELUDE_V1__";
  if (globalThis[FLAG]) return;

  const MAX_COMPAT_AGENTS = 5;
  const DEFAULT_VISIBLE_COUNT = 3;

  function sideForOrdinal(ordinal) {
    const value = Number(ordinal);
    if (!Number.isInteger(value) || value < 1 || value > MAX_COMPAT_AGENTS) return null;
    return String.fromCharCode(64 + value);
  }

  function agentIdForOrdinal(ordinal) {
    const side = sideForOrdinal(ordinal);
    return side ? "agent-" + ordinal : null;
  }

  function createTimer(id, text, title) {
    const node = document.createElement("span");
    node.id = id;
    node.className = "round-timer idle";
    node.textContent = text;
    node.title = title;
    return node;
  }

  function createAgentCard(ordinal) {
    const side = sideForOrdinal(ordinal);
    if (!side) throw new RangeError("Unsupported compatibility roster ordinal.");

    const card = document.createElement("article");
    card.className = "agent-card agent-" + side.toLowerCase();
    card.dataset.side = side;
    card.dataset.agentId = agentIdForOrdinal(ordinal);
    card.dataset.ordinal = String(ordinal);
    card.hidden = ordinal > DEFAULT_VISIBLE_COUNT;

    const topline = document.createElement("div");
    topline.className = "agent-topline";

    const identity = document.createElement("div");
    identity.className = "agent-identity";

    const title = document.createElement("strong");
    title.id = "labelText" + side;
    title.textContent = "AI " + side;

    const timers = document.createElement("div");
    timers.className = "agent-timers";
    timers.append(
      createTimer(
        "timerTotal" + side,
        "Total 0s",
        "Total working time for this LLM in the current session"
      ),
      createTimer(
        "timerCurrent" + side,
        "Current —",
        "Current turn timer for this LLM"
      )
    );

    identity.append(title, timers);

    const actions = document.createElement("div");
    actions.className = "agent-actions";

    const actionSpecs = [
      ["newChat", "New chat", false],
      ["resend", "Resend", true],
      ["useLast", "Use last reply", true]
    ];
    for (const [prefix, label, disabled] of actionSpecs) {
      const button = document.createElement("button");
      button.id = prefix + side;
      button.type = "button";
      button.className = "tiny ghost";
      button.textContent = label;
      button.disabled = disabled;
      actions.appendChild(button);
    }

    topline.append(identity, actions);

    const tab = document.createElement("select");
    tab.id = "tab" + side;
    tab.setAttribute("aria-label", "AI " + side + " tab");

    const job = document.createElement("textarea");
    job.id = "job" + side;
    job.rows = 3;
    job.placeholder = "AI " + side + " job / responsibility";

    card.append(topline, tab, job);
    return card;
  }

  function createManualSourceButton(ordinal) {
    const side = sideForOrdinal(ordinal);
    const button = document.createElement("button");
    button.id = "forceFrom" + side;
    button.className = "layout-chip" + (ordinal === 1 ? " active" : "");
    button.type = "button";
    button.textContent = side;
    button.setAttribute("aria-pressed", ordinal === 1 ? "true" : "false");
    button.hidden = ordinal > DEFAULT_VISIBLE_COUNT;
    return button;
  }

  function createManualTarget(ordinal) {
    const side = sideForOrdinal(ordinal);
    const label = document.createElement("label");
    label.className = "check-line";
    label.hidden = ordinal > DEFAULT_VISIBLE_COUNT;

    const input = document.createElement("input");
    input.id = "forceTo" + side;
    input.type = "checkbox";
    input.checked = ordinal > 1 && ordinal <= DEFAULT_VISIBLE_COUNT;

    label.append(input, document.createTextNode(" " + side));
    return label;
  }

  function initializeGeneratedRoster() {
    const rosterHost = document.getElementById("agentRosterHost");
    const fromHost = document.querySelector(".manual-relay-from");
    const toHost = document.querySelector(".manual-relay-to");
    if (!rosterHost || !fromHost || !toHost) {
      throw new Error("Generated roster UI hosts are missing.");
    }

    rosterHost.replaceChildren();
    fromHost.replaceChildren();
    toHost.replaceChildren();

    for (let ordinal = 1; ordinal <= MAX_COMPAT_AGENTS; ordinal += 1) {
      rosterHost.appendChild(createAgentCard(ordinal));
      fromHost.appendChild(createManualSourceButton(ordinal));
      toHost.appendChild(createManualTarget(ordinal));
    }

    return Object.freeze(
      Array.from({ length: MAX_COMPAT_AGENTS }, (_, index) => sideForOrdinal(index + 1))
    );
  }

  const sides = initializeGeneratedRoster();

  globalThis[FLAG] = Object.freeze({
    version: 1,
    maxCompatibilityAgents: MAX_COMPAT_AGENTS,
    defaultVisibleCount: DEFAULT_VISIBLE_COUNT,
    sides,
    sideForOrdinal,
    agentIdForOrdinal,
    generatedBeforeLegacyHandlers: true,
    canonicalAgentMetadata: true,
    safeDomOnly: true
  });
})();