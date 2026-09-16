(() => {
  "use strict";

  const GENERIC_GOOGLE_SETUP_NOTICE = "Google login is not configured yet.";
  const GOOGLE_SETUP_NOTICE = "Google Drive login is optional. For this unpacked build, create a Google Cloud Web OAuth client using the Extension ID and Authorized redirect URI shown below, paste the client ID, Save, then Link. Chrome Sync Push/Pull works without Google Drive.";
  const SETUP_NOTICE_POLL_MS = 50;
  const SETUP_NOTICE_POLL_LIMIT_MS = 3000;
  const FOCUS_TAB_KEY = "aiBridgeFocusTab";
  const FOCUS_TABS = new Set(["run", "team", "files", "activity"]);

  // Keep visible version surfaces tied to the installed manifest so a future
  // release cannot accidentally ship a stale hard-coded badge.
  try {
    const version = String(chrome.runtime.getManifest()?.version || "").trim();
    if (version) {
      const badge = document.getElementById("versionBadge");
      const installed = document.getElementById("installedVersionPill");
      if (badge) badge.textContent = `v${version}`;
      if (installed) installed.textContent = `v${version}`;
    }
  } catch (_) {}

  function refineGoogleSetupNotice(deadline) {
    const notice = document.getElementById("cloudNotice");
    const client = document.getElementById("googleClientId");
    if (!notice || String(client?.value || "").trim()) return;

    if (notice.textContent.trim() === GENERIC_GOOGLE_SETUP_NOTICE) {
      notice.textContent = GOOGLE_SETUP_NOTICE;
      notice.classList.remove("error");
      return;
    }

    // dashboard.js awaits the background response before it writes the generic
    // setup notice. A zero-delay listener can therefore run too early. Poll for
    // only three seconds after the explicit Link click; no idle/background loop.
    if (Date.now() < deadline) {
      setTimeout(() => refineGoogleSetupNotice(deadline), SETUP_NOTICE_POLL_MS);
    }
  }

  const linkButton = document.getElementById("cloudConnect");
  if (linkButton) {
    linkButton.addEventListener("click", () => {
      const deadline = Date.now() + SETUP_NOTICE_POLL_LIMIT_MS;
      setTimeout(() => refineGoogleSetupNotice(deadline), 0);
    });
  }

  // -------------------------------------------------------------------------
  // Focus layout: a third, independent information architecture.
  // -------------------------------------------------------------------------
  // dashboard.js owns all functional controls. Focus deliberately reuses those
  // nodes instead of cloning them, so every existing ID, listener, security
  // check, and coordinator endpoint remains single-sourced.
  try {
    if (typeof LAYOUTS !== "undefined" && LAYOUTS instanceof Set) {
      LAYOUTS.add("focus");
    }

    const focusStyles = document.createElement("link");
    focusStyles.rel = "stylesheet";
    focusStyles.href = chrome.runtime.getURL("dashboard-focus.css");
    focusStyles.dataset.aiBridgeFocusStyles = "true";
    document.head.appendChild(focusStyles);

    const tagGroup = (selector, groups) => {
      const node = document.querySelector(selector);
      if (node) node.setAttribute("data-focus-group", groups);
      return node;
    };
    tagGroup(".runtime-card", "run");
    tagGroup(".objective-section", "run");
    tagGroup(".team-section", "team");
    tagGroup(".strategy-section", "team");
    tagGroup(".files-section", "files");
    tagGroup("#vaultPanel", "files");
    tagGroup(".workspace", "activity");

    const nav = document.createElement("nav");
    nav.id = "focusNav";
    nav.className = "focus-nav";
    nav.setAttribute("role", "tablist");
    nav.setAttribute("aria-label", "Focus workspace");

    const focusButtons = new Map();
    const tabSpecs = [
      ["run", "Run"],
      ["team", "Team"],
      ["files", "Files"],
      ["activity", "Activity"]
    ];

    function normalizeFocusTab(raw) {
      const value = String(raw || "").toLowerCase();
      return FOCUS_TABS.has(value) ? value : "run";
    }

    function setFocusTab(raw, { persist = true, focus = false } = {}) {
      const tab = normalizeFocusTab(raw);
      document.documentElement.dataset.focusTab = tab;
      for (const [value, button] of focusButtons) {
        const selected = value === tab;
        button.setAttribute("aria-selected", selected ? "true" : "false");
        button.tabIndex = selected ? 0 : -1;
        if (selected && focus) button.focus();
      }
      if (persist) {
        try { localStorage.setItem(FOCUS_TAB_KEY, tab); } catch (_) {}
      }
      return tab;
    }

    for (let index = 0; index < tabSpecs.length; index += 1) {
      const [value, label] = tabSpecs[index];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "focus-tab ghost";
      button.textContent = label;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", "false");
      button.dataset.focusTab = value;
      button.addEventListener("click", () => setFocusTab(value, { focus: false }));
      button.addEventListener("keydown", event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const current = tabSpecs.findIndex(([tab]) => tab === document.documentElement.dataset.focusTab);
        let next = current < 0 ? 0 : current;
        if (event.key === "ArrowLeft") next = (next - 1 + tabSpecs.length) % tabSpecs.length;
        if (event.key === "ArrowRight") next = (next + 1) % tabSpecs.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = tabSpecs.length - 1;
        setFocusTab(tabSpecs[next][0], { focus: true });
      });
      focusButtons.set(value, button);
      nav.appendChild(button);
    }

    const topbar = document.querySelector(".studio-slot-topbar");
    const header = document.querySelector(".brand-block");
    if (topbar && header) header.insertAdjacentElement("afterend", nav);
    else document.body.prepend(nav);

    const layoutSelect = document.getElementById("layoutSelect");
    if (layoutSelect && ![...layoutSelect.options].some(option => option.value === "focus")) {
      const option = document.createElement("option");
      option.value = "focus";
      option.textContent = "Focus — clean tabbed workspace";
      layoutSelect.appendChild(option);
    }

    const layoutSwitch = document.querySelector(".layout-switch");
    let focusLayoutButton = document.getElementById("layoutFocusBtn");
    if (layoutSwitch && !focusLayoutButton) {
      focusLayoutButton = document.createElement("button");
      focusLayoutButton.id = "layoutFocusBtn";
      focusLayoutButton.className = "layout-chip";
      focusLayoutButton.type = "button";
      focusLayoutButton.textContent = "Focus";
      focusLayoutButton.setAttribute("aria-pressed", "false");
      layoutSwitch.appendChild(focusLayoutButton);
      focusLayoutButton.addEventListener("click", async () => {
        if (typeof persistLayout === "function") await persistLayout("focus");
      });
    }

    if (typeof applyLayout === "function") {
      const baseApplyLayout = applyLayout;
      applyLayout = function focusAwareApplyLayout(layout) {
        const chosen = typeof LAYOUTS !== "undefined" && LAYOUTS.has(layout) ? layout : "studio";
        baseApplyLayout(chosen);
        document.body.classList.toggle("is-focus", chosen === "focus");
        if (focusLayoutButton) {
          focusLayoutButton.classList.toggle("active", chosen === "focus");
          focusLayoutButton.setAttribute("aria-pressed", chosen === "focus" ? "true" : "false");
        }
        if (chosen === "focus") {
          let remembered = "run";
          try { remembered = localStorage.getItem(FOCUS_TAB_KEY) || "run"; } catch (_) {}
          setFocusTab(remembered, { persist: false });
        }
      };
    }

    let initialFocusTab = "run";
    try { initialFocusTab = localStorage.getItem(FOCUS_TAB_KEY) || "run"; } catch (_) {}
    setFocusTab(initialFocusTab, { persist: false });

    // loadLayout() is asynchronous and may have started before this release
    // layer extended LAYOUTS. Re-apply a stored Focus preference once so an
    // upgrade cannot momentarily snap the user back to Studio.
    chrome.storage.local.get("aiBridgeLayout").then(stored => {
      if (stored?.aiBridgeLayout === "focus" && typeof applyLayout === "function") {
        applyLayout("focus");
      }
    }).catch(() => {});

    window.__AI_BRIDGE_FOCUS_LAYOUT__ = Object.freeze({
      version: 1,
      tabs: Object.freeze([...FOCUS_TABS]),
      preservesExistingControlIds: true
    });
  } catch (error) {
    console.error("AI Bridge Focus layout failed to initialize", error);
  }
})();
