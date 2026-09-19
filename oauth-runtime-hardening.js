(() => {
  "use strict";

  // OAuth security boundary.
  //
  // Google OAuth for Chrome extensions belongs on chrome.identity.getAuthToken
  // with a Chrome-Extension OAuth client declared in manifest.oauth2. The old
  // unpacked-build fallback used launchWebAuthFlow(response_type=token), which
  // placed an access token in the redirect URL fragment. Keep Drive optional
  // and fail closed instead of retaining that implicit-flow credential path.

  if (typeof launchGoogleWebAuth !== "function" ||
      typeof clearPendingOauthState !== "function" ||
      typeof consumePendingOauthState !== "function") {
    console.warn("AI Bridge OAuth hardening could not attach to background runtime");
    return;
  }

  const LEGACY_WEB_OAUTH_DISABLED_MESSAGE =
    "Google Drive OAuth is disabled in this unpacked build because the legacy Web-client implicit flow exposed access tokens in the redirect URL. Configure a Chrome-Extension OAuth client in manifest.oauth2 for packaged builds, or use Chrome Sync Push/Pull without Google Drive.";

  const baseConsumePendingOauthState = consumePendingOauthState;
  consumePendingOauthState = async function hardenedConsumePendingOauthState() {
    const record = await baseConsumePendingOauthState();
    if (!record) return null;

    // The record is created and consumed in the same browser session. A zero,
    // non-finite, or future creation time is invalid and must fail closed.
    const createdAt = Number(record.createdAt);
    if (!Number.isFinite(createdAt) || createdAt <= 0 || createdAt > Date.now()) {
      return null;
    }
    return record;
  };

  // The implicit Google Web flow is intentionally unreachable in v1.17.1.
  // Leave the core implementation present for migration archaeology, but make
  // the loaded service-worker binding fail closed before launchWebAuthFlow.
  launchGoogleWebAuth = async function disabledLegacyGoogleWebAuth() {
    await clearPendingOauthState();
    throw new Error(LEGACY_WEB_OAUTH_DISABLED_MESSAGE);
  };

  // A packaged build with manifest.oauth2 continues to use Chrome Identity's
  // cached token path. An unpacked build without that configuration is simply
  // "not configured"; it must not fall through to a user-pasted Web client.
  if (typeof googleOauthReady === "function" && typeof googleOauthPackaged === "function") {
    googleOauthReady = async function hardenedGoogleOauthReady() {
      return Boolean(googleOauthPackaged());
    };
  }

  if (typeof getGoogleAccessTokenUnlocked === "function" && typeof googleOauthPackaged === "function") {
    const baseGetGoogleAccessTokenUnlocked = getGoogleAccessTokenUnlocked;
    getGoogleAccessTokenUnlocked = async function hardenedGetGoogleAccessTokenUnlocked(options = {}) {
      if (!googleOauthPackaged()) {
        await clearPendingOauthState();
        throw new Error(LEGACY_WEB_OAUTH_DISABLED_MESSAGE);
      }
      return baseGetGoogleAccessTokenUnlocked(options);
    };
  }

  // User-supplied Web client IDs are no longer an executable credential path.
  // Clear any previously stored value and session token if the old Settings UI
  // sends a save request. Chrome Sync remains available independently.
  if (typeof saveUserOauthClientId === "function" &&
      typeof clearSessionGoogleToken === "function") {
    const baseSaveUserOauthClientId = saveUserOauthClientId;
    saveUserOauthClientId = async function hardenedSaveUserOauthClientId() {
      const result = await baseSaveUserOauthClientId("");
      await clearSessionGoogleToken();
      await clearPendingOauthState();
      try {
        await chrome.storage.local.set({ [GOOGLE_LINKED_KEY]: false });
      } catch (_) {}
      return {
        ...result,
        saved: false,
        googleLinked: false,
        legacyWebClientDisabled: true
      };
    };
  }

  if (typeof connectGoogleAccount === "function" &&
      typeof googleOauthPackaged === "function") {
    const baseConnectGoogleAccount = connectGoogleAccount;
    connectGoogleAccount = async function hardenedConnectGoogleAccount() {
      if (!googleOauthPackaged()) {
        return {
          googleLinked: false,
          googleConfigured: false,
          setupRequired: true,
          setupKind: "chrome-extension-oauth-client",
          setupMessage: LEGACY_WEB_OAUTH_DISABLED_MESSAGE,
          legacyWebClientDisabled: true,
          driveScope: typeof DRIVE_APP_DATA_SCOPE === "string" ? DRIVE_APP_DATA_SCOPE : ""
        };
      }
      return baseConnectGoogleAccount();
    };
  }

  globalThis.__AI_BRIDGE_OAUTH_SECURITY__ = Object.freeze({
    version: 3,
    googleImplicitFlowDisabled: true,
    packagedGoogleAuthUsesChromeIdentity: true
  });
})();
