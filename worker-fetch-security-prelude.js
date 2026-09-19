(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_WORKER_FETCH_SECURITY_V1__";
  if (globalThis[FLAG]) return;

  const nativeFetch = globalThis.fetch.bind(globalThis);

  /**
   * AI Bridge never relies on ambient browser cookies for privileged worker
   * network requests. Google Drive uses an explicit Authorization bearer header,
   * GitHub update checks are public, and provider artifact URLs are treated as
   * untrusted data. Force HTTP(S) fetches to credentials:"omit" before the
   * coordinator source is evaluated so a future source regression cannot turn
   * a model-controlled URL into an authenticated request primitive.
   *
   * Explicit Authorization headers are preserved. Only ambient cookie / HTTP
   * authentication credentials controlled by Fetch's `credentials` mode are
   * suppressed.
   */
  globalThis.fetch = function aiBridgeCredentiallessWorkerFetch(input, init = undefined) {
    let protocol = "";
    try {
      const raw = typeof input === "string" || input instanceof URL
        ? String(input)
        : String(input?.url || "");
      protocol = new URL(raw, globalThis.location?.href || "chrome-extension://invalid/").protocol;
    } catch (_) {}

    if (protocol === "http:" || protocol === "https:") {
      return nativeFetch(input, { ...(init || {}), credentials: "omit" });
    }
    return nativeFetch(input, init);
  };

  globalThis[FLAG] = Object.freeze({
    version: 1,
    httpCredentials: "omit",
    loadsBeforeCoordinator: true
  });
})();
