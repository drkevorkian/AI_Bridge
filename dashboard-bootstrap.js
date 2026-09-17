(() => {
  "use strict";

  const VALID_LAYOUT_HINTS = new Set(["studio", "classic", "focus"]);
  const PROVIDER_TAB_PATTERNS = Object.freeze([
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://grok.com/*",
    "https://claude.ai/*",
    "https://gemini.google.com/*",
    "https://copilot.microsoft.com/*"
  ]);

  // Manifest V3 extension pages cannot execute inline JavaScript under the
  // default `script-src 'self'` policy. Keep first-paint behavior in a packaged
  // script so dashboard.html stays CSP-clean.
  try {
    const hint = localStorage.getItem("aiBridgeLayoutHint");
    document.documentElement.dataset.layout = VALID_LAYOUT_HINTS.has(hint) ? hint : "studio";
  } catch (_) {
    document.documentElement.dataset.layout = "studio";
  }

  // dashboard.js historically called chrome.tabs.query({}) and filtered the
  // result afterwards. Restrict that empty query to the supported provider URLs.
  try {
    const nativeTabsQuery = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = function hardenedDashboardTabsQuery(queryInfo = {}) {
      const keys = queryInfo && typeof queryInfo === "object" ? Object.keys(queryInfo) : [];
      if (!keys.length) {
        return nativeTabsQuery({ url: [...PROVIDER_TAB_PATTERNS] });
      }
      return nativeTabsQuery(queryInfo);
    };
  } catch (error) {
    console.error("AI Bridge could not install dashboard tab-query hardening", error);
  }

  // v1.17 disables the old user-pasted Web OAuth implicit flow.
  window.addEventListener("DOMContentLoaded", () => {
    const input = document.getElementById("googleClientId");
    const save = document.getElementById("saveGoogleClientId");
    const label = document.querySelector("label[for='googleClientId']");
    if (input) {
      input.disabled = true;
      input.value = "";
      input.placeholder = "Disabled — configure manifest.oauth2 for packaged Drive support";
    }
    if (save) {
      save.disabled = true;
      save.textContent = "Web OAuth disabled";
      save.title = "The legacy response_type=token Web OAuth flow is disabled for security.";
    }
    if (label) label.textContent = "Legacy Web OAuth client ID (disabled)";
    if (input && !document.getElementById("oauthSecurityNotice")) {
      const notice = document.createElement("div");
      notice.id = "oauthSecurityNotice";
      notice.className = "field-help";
      notice.textContent = "Google Drive now requires a packaged Chrome Extension OAuth client declared in manifest.oauth2. Chrome Sync Push/Pull does not require Google Drive.";
      input.insertAdjacentElement("afterend", notice);
    }

    // Load dynamic roster wiring only after dashboard.js and dashboard-release.js
    // have registered their legacy A/B/C handlers. Once the adapter reports its
    // thread-conflict safeguards, expose the active viewpoint policy through a
    // second packaged script. This keeps activation diagnostics truthful without
    // making the dashboard marker authoritative for routing.
    if (!document.querySelector("script[data-ai-bridge-dynamic-agents]")) {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("dashboard-dynamic-agents.js");
      script.async = false;
      script.dataset.aiBridgeDynamicAgents = "true";
      script.addEventListener("load", () => {
        if (document.querySelector("script[data-ai-bridge-viewpoint-activation]")) return;
        const activation = document.createElement("script");
        activation.src = chrome.runtime.getURL("dashboard-viewpoint-activation.js");
        activation.async = false;
        activation.dataset.aiBridgeViewpointActivation = "true";
        document.body.appendChild(activation);
      }, { once: true });
      document.body.appendChild(script);
    }
  }, { once: true });

  window.__AI_BRIDGE_DASHBOARD_BOOTSTRAP__ = Object.freeze({
    version: 5,
    providerScopedTabQuery: true,
    legacyWebOauthDisabled: true,
    dynamicAgentAdapter: true,
    viewpointActivationAdapter: true,
    layouts: Object.freeze(["studio", "classic", "focus"])
  });
})();
