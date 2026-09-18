(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_CONTENT_ARTIFACT_SECURITY_V1__";
  if (window[FLAG]) return;

  const nativeFetch = globalThis.fetch.bind(globalThis);

  function currentChatGptConversationId() {
    if (!(location.hostname === "chatgpt.com" || location.hostname === "chat.openai.com")) return "";
    const match = location.pathname.match(/(?:^|\/)c\/([^/?#]+)/);
    return match?.[1] || "";
  }

  /**
   * The only page-local request that may carry provider credentials is the
   * current ChatGPT conversation's interpreter-download endpoint. It is needed
   * for sandbox:/mnt/data artifacts that are not public signed URLs.
   *
   * Every other DOM-supplied URL is attacker-controlled data and is forced to
   * credentials:"omit". This prevents a rendered model link from turning the
   * content script into an authenticated GET primitive against arbitrary
   * provider endpoints.
   */
  function authenticatedArtifactUrlAllowed(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ""), location.href);
      if (url.protocol !== "https:" || url.origin !== location.origin) return false;
      if (url.username || url.password || (url.port && url.port !== "443")) return false;

      const conversationId = currentChatGptConversationId();
      if (!conversationId) return false;
      const expectedPath = `/backend-api/conversation/${encodeURIComponent(conversationId)}/interpreter/download`;
      if (url.pathname !== expectedPath) return false;

      const messageId = String(url.searchParams.get("message_id") || "");
      const sandboxPath = String(url.searchParams.get("sandbox_path") || "");
      if (!messageId || messageId.length > 256) return false;
      if (!sandboxPath.startsWith("/mnt/data/") || sandboxPath.length > 1024) return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  globalThis.fetch = function hardenedContentFetch(input, init = undefined) {
    const requestedCredentials = String(init?.credentials || "");
    if (requestedCredentials !== "include") {
      return nativeFetch(input, init);
    }

    let rawUrl = "";
    try {
      rawUrl = typeof input === "string" || input instanceof URL ? String(input) : String(input?.url || "");
    } catch (_) {}

    const credentials = authenticatedArtifactUrlAllowed(rawUrl) ? "include" : "omit";
    return nativeFetch(input, { ...(init || {}), credentials });
  };

  window[FLAG] = Object.freeze({
    version: 1,
    defaultCredentials: "omit",
    authenticatedScope: "current-chatgpt-interpreter-download-only"
  });
})();
