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

  // v1.17 disables the old user-pasted Web OAuth implicit flow. Keep the legacy
  // controls visible for migration context, but make them non-actionable and
  // explain the supported path: manifest.oauth2 + Chrome Extension OAuth client
  // (or Chrome Sync when Drive integration is not configured).
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
  }, { once: true });

  window.__AI_BRIDGE_DASHBOARD_BOOTSTRAP__ = Object.freeze({
    version: 3,
    providerScopedTabQuery: true,
    legacyWebOauthDisabled: true,
    layouts: Object.freeze(["studio", "classic", "focus"])
  });
})();
