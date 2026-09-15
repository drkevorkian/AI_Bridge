(() => {
  "use strict";

  // v1.16.x OAuth hardening lives beside the core coordinator so the security
  // invariants stay easy to audit without inflating background.js further.
  // The core runtime still owns the actual OAuth, Drive, and cloud-sync logic.

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

    // The record is created and consumed in the same browser session. A zero,
    // non-finite, or future creation time is invalid and must fail closed.
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
      // Idempotent. background.js already clears on URL rejection and
      // launchWebAuthFlow rejection; this additionally covers callback parser,
      // state, client-id, and TTL validation failures.
      await clearPendingOauthState();
      throw err;
    }
  };

  // A cached user-client token is bound to the OAuth client that issued it.
  // Replacing one non-empty client ID with another must invalidate that token
  // and the local linked flag. Reusing the old token with a new client ID is
  // both confusing and an avoidable cross-configuration trust bug.
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

  // Missing publisher OAuth configuration is an installation/deployment state,
  // not a runtime crash. The old connectGoogleAccount() deliberately threw so
  // the feature failed closed, but the top-level message handler logged that
  // expected condition as "AI Bridge background error" and exposed a stack
  // trace to the user. Preserve fail-closed behavior without treating it as an
  // exception: no token is requested, no Drive call occurs, and the dashboard
  // receives a normal unlinked/setupRequired result.
  if (typeof connectGoogleAccount === "function" &&
      typeof googleOauthReady === "function") {
    const baseConnectGoogleAccount = connectGoogleAccount;
    connectGoogleAccount = async function hardenedConnectGoogleAccount() {
      if (!(await googleOauthReady())) {
        return {
          googleLinked: false,
          googleConfigured: false,
          setupRequired: true,
          setupKind: "publisher-oauth",
          driveScope: typeof DRIVE_APP_DATA_SCOPE === "string" ? DRIVE_APP_DATA_SCOPE : ""
        };
      }
      return baseConnectGoogleAccount();
    };
  }
})();
