(() => {
  "use strict";

  // OAuth security boundary.
  //
  // The implicit token grant is forbidden. Unpacked builds may still use a
  // user-supplied Web application client, but only through Authorization Code
  // + PKCE (S256) implemented in background.js. Packaged builds with
  // manifest.oauth2 continue to use chrome.identity.getAuthToken.

  if (typeof launchGoogleWebAuth !== "function" ||
      typeof clearPendingOauthState !== "function" ||
      typeof consumePendingOauthState !== "function") {
    console.warn("AI Bridge OAuth hardening could not attach to background runtime");
    return;
  }

  const baseConsumePendingOauthState = consumePendingOauthState;
  consumePendingOauthState = async function hardenedConsumePendingOauthState() {
    const record = await baseConsumePendingOauthState();
    if (!record) return null;
    const createdAt = Number(record.createdAt);
    if (!Number.isFinite(createdAt) || createdAt <= 0 || createdAt > Date.now()) {
      return null;
    }
    return record;
  };

  const baseLaunchGoogleWebAuth = launchGoogleWebAuth;
  launchGoogleWebAuth = async function hardenedLaunchGoogleWebAuth(options) {
    try {
      return await baseLaunchGoogleWebAuth(options);
    } catch (err) {
      await clearPendingOauthState();
      throw err;
    }
  };

  if (typeof saveUserOauthClientId === "function" &&
      typeof readUserOauthClientId === "function" &&
      typeof clearSessionGoogleToken === "function") {
    const baseSaveUserOauthClientId = saveUserOauthClientId;
    saveUserOauthClientId = async function hardenedSaveUserOauthClientId(raw) {
      const previousId = await readUserOauthClientId();
      const result = await baseSaveUserOauthClientId(raw);
      const nextId = await readUserOauthClientId();
      if (previousId && nextId && previousId !== nextId) {
        await clearSessionGoogleToken();
        await clearPendingOauthState();
        try {
          await chrome.storage.local.set({ [GOOGLE_LINKED_KEY]: false });
        } catch (_) {}
        return { ...result, googleLinked: false, relinkRequired: true };
      }
      return result;
    };
  }

  if (typeof connectGoogleAccount === "function" &&
      typeof googleOauthReady === "function") {
    const baseConnectGoogleAccount = connectGoogleAccount;
    connectGoogleAccount = async function hardenedConnectGoogleAccount() {
      if (!(await googleOauthReady())) {
        return {
          googleLinked: false,
          googleConfigured: false,
          setupRequired: true,
          setupKind: "oauth-client",
          setupMessage: "Google Drive login is optional. In Settings, configure a Web OAuth client ID for this unpacked extension (Authorization Code + PKCE), or use Chrome Sync without Google Drive.",
          driveScope: typeof DRIVE_APP_DATA_SCOPE === "string" ? DRIVE_APP_DATA_SCOPE : ""
        };
      }
      return baseConnectGoogleAccount();
    };
  }

  globalThis.__AI_BRIDGE_OAUTH_SECURITY__ = Object.freeze({
    version: 4,
    googleImplicitFlowDisabled: true,
    pkceAuthorizationCode: true,
    packagedGoogleAuthUsesChromeIdentity: true
  });
})();
