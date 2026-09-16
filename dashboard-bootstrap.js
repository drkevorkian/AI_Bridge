(() => {
  "use strict";

  // Manifest V3 extension pages cannot execute inline JavaScript under the
  // default `script-src 'self'` policy. Keep this tiny first-paint layout hint
  // in a packaged script so dashboard.html stays CSP-clean.
  try {
    const hint = localStorage.getItem("aiBridgeLayoutHint");
    const allowed = new Set(["studio", "classic", "focus"]);
    document.documentElement.dataset.layout = allowed.has(hint) ? hint : "studio";
  } catch (_) {
    document.documentElement.dataset.layout = "studio";
  }
})();
