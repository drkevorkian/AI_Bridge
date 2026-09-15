(() => {
  "use strict";

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

  // background.js intentionally reports missing OAuth configuration as a
  // normal setupRequired state instead of throwing. dashboard.js predates that
  // richer response and falls back to a generic notice, so refine only that
  // exact UI case without changing cloud message plumbing or auth behavior.
  const linkButton = document.getElementById("cloudConnect");
  if (linkButton) {
    linkButton.addEventListener("click", () => {
      setTimeout(() => {
        const notice = document.getElementById("cloudNotice");
        const client = document.getElementById("googleClientId");
        if (!notice || String(client?.value || "").trim()) return;
        if (notice.textContent.trim() !== "Google login is not configured yet.") return;
        notice.textContent = "Google Drive login is optional. For this unpacked build, create a Google Cloud Web OAuth client using the Extension ID and Authorized redirect URI shown below, paste the client ID, Save, then Link. Chrome Sync Push/Pull works without Google Drive.";
        notice.classList.remove("error");
      }, 0);
    });
  }
})();
