(() => {
  "use strict";

  // v1.16.0 added a one-time OAuth CSRF record in chrome.storage.session.
  // Keep the core implementation fail-closed even when Google returns a
  // syntactically valid redirect that parseImplicitOAuthRedirect() rejects
  // (for example access_denied or malformed token data). Without this guard,
  // that parser exception occurs before background.js consumes the pending
  // record, leaving it resident until a later login overwrites it or its TTL
  // becomes irrelevant.
  //
  // This runtime shim is intentionally small and loaded immediately after the
  // core coordination/completion runtime. A later refactor can fold the same
  // invariants directly into background.js without changing behavior.

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
})();
