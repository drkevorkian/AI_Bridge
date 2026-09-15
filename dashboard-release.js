(() => {
  "use strict";

  const GENERIC_GOOGLE_SETUP_NOTICE = "Google login is not configured yet.";
  const GOOGLE_SETUP_NOTICE = "Google Drive login is optional. For this unpacked build, create a Google Cloud Web OAuth client using the Extension ID and Authorized redirect URI shown below, paste the client ID, Save, then Link. Chrome Sync Push/Pull works without Google Drive.";
  const SETUP_NOTICE_POLL_MS = 50;
  const SETUP_NOTICE_POLL_LIMIT_MS = 3000;

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
})();
