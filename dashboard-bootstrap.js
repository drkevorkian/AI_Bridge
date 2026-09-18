(() => {
  "use strict";

  const VALID_LAYOUT_HINTS = new Set(["studio", "classic", "focus"]);
  const RECOVERY_QUARANTINE_UI = true;
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
    if (RECOVERY_QUARANTINE_UI) {
      const badge = document.getElementById("versionBadge");
      const status = document.getElementById("status");
      if (badge) badge.textContent = "RECOVERY-Q";
      if (status) status.textContent = "Recovery quarantine — production state and dynamic adapters are disabled.";
      document.documentElement.dataset.recoveryQuarantine = "true";
    }

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
    // have registered their legacy A/B/C handlers. The roster adapter is followed
    // by packaged compatibility/read-only adapters that remove fixed-three UI
    // assumptions, add side-specific accessible names, expose live provider-health
    // status to assistive technology, trigger authoritative health re-probes when a
    // bound browser tab changes, keep Start visually gated by fail-closed health,
    // keep work-mode copy aligned to the live A-E roster, and expose viewpoint
    // activation diagnostics. Routing authority remains in the centralized
    // background binding evaluator.
    if (!RECOVERY_QUARANTINE_UI && !document.querySelector("script[data-ai-bridge-dynamic-agents]")) {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("dashboard-dynamic-agents.js");
      script.async = false;
      script.dataset.aiBridgeDynamicAgents = "true";
      script.addEventListener("load", () => {
        if (!document.querySelector("script[data-ai-bridge-dynamic-accessibility]")) {
          const accessibility = document.createElement("script");
          accessibility.src = chrome.runtime.getURL("dashboard-dynamic-accessibility.js");
          accessibility.async = false;
          accessibility.dataset.aiBridgeDynamicAccessibility = "true";
          document.body.appendChild(accessibility);
        }
        if (!document.querySelector("script[data-ai-bridge-provider-health-accessibility]")) {
          const healthAccessibility = document.createElement("script");
          healthAccessibility.src = chrome.runtime.getURL("dashboard-provider-health-accessibility.js");
          healthAccessibility.async = false;
          healthAccessibility.dataset.aiBridgeProviderHealthAccessibility = "true";
          document.body.appendChild(healthAccessibility);
        }
        if (!document.querySelector("script[data-ai-bridge-provider-health-live-refresh]")) {
          const healthLiveRefresh = document.createElement("script");
          healthLiveRefresh.src = chrome.runtime.getURL("dashboard-provider-health-live-refresh.js");
          healthLiveRefresh.async = false;
          healthLiveRefresh.dataset.aiBridgeProviderHealthLiveRefresh = "true";
          document.body.appendChild(healthLiveRefresh);
        }
        if (!document.querySelector("script[data-ai-bridge-provider-health-start-gate]")) {
          const healthStartGate = document.createElement("script");
          healthStartGate.src = chrome.runtime.getURL("dashboard-provider-health-start-gate.js");
          healthStartGate.async = false;
          healthStartGate.dataset.aiBridgeProviderHealthStartGate = "true";
          document.body.appendChild(healthStartGate);
        }
        if (!document.querySelector("script[data-ai-bridge-dynamic-validation]")) {
          const validation = document.createElement("script");
          validation.src = chrome.runtime.getURL("dashboard-dynamic-validation.js");
          validation.async = false;
          validation.dataset.aiBridgeDynamicValidation = "true";
          document.body.appendChild(validation);
        }
        if (!document.querySelector("script[data-ai-bridge-dynamic-workmode-copy]")) {
          const copy = document.createElement("script");
          copy.src = chrome.runtime.getURL("dashboard-dynamic-workmode-copy.js");
          copy.async = false;
          copy.dataset.aiBridgeDynamicWorkmodeCopy = "true";
          document.body.appendChild(copy);
        }
        if (!document.querySelector("script[data-ai-bridge-viewpoint-activation]")) {
          const activation = document.createElement("script");
          activation.src = chrome.runtime.getURL("dashboard-viewpoint-activation.js");
          activation.async = false;
          activation.dataset.aiBridgeViewpointActivation = "true";
          document.body.appendChild(activation);
        }
      }, { once: true });
      document.body.appendChild(script);
    }
  }, { once: true });

  window.__AI_BRIDGE_DASHBOARD_BOOTSTRAP__ = Object.freeze({
    version: 11,
    providerScopedTabQuery: true,
    legacyWebOauthDisabled: true,
    dynamicAgentAdapter: true,
    dynamicAccessibilityAdapter: true,
    providerHealthAccessibilityAdapter: true,
    providerHealthLiveRefreshAdapter: true,
    providerHealthStartGateAdapter: true,
    dynamicTabValidationAdapter: true,
    dynamicWorkModeCopyAdapter: true,
    viewpointActivationAdapter: !RECOVERY_QUARANTINE_UI,
    recoveryQuarantineUi: RECOVERY_QUARANTINE_UI,
    layouts: Object.freeze(["studio", "classic", "focus"])
  });
})();
