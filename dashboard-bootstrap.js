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
  // result afterwards. That grants the dashboard process visibility into every
  // open tab's URL/title even though it only needs supported AI tabs. Restrict
  // the empty dashboard query before dashboard.js executes. Non-empty queries
  // remain untouched so feature-specific lookups keep their intended scope.
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

  window.__AI_BRIDGE_DASHBOARD_BOOTSTRAP__ = Object.freeze({
    version: 3,
    providerScopedTabQuery: true,
    legacyWebOauthDisabled: false,
    layouts: Object.freeze(["studio", "classic", "focus"]),
    pkceAuthorizationCode: true
  });
})();
