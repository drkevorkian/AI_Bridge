/**
 * conversation-identity.js
 * Review-only provider conversation identity parser.
 *
 * Produces sanitized identity metadata only. Query strings, hashes, page text,
 * auth tokens and arbitrary provider data are deliberately excluded.
 */

const SUPPORTED = new Set(["chatgpt", "grok", "claude", "gemini", "copilot"]);

function providerFromHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (host === "chatgpt.com" || host === "chat.openai.com") return "chatgpt";
  if (host === "grok.com") return "grok";
  if (host === "claude.ai") return "claude";
  if (host === "gemini.google.com") return "gemini";
  if (host === "copilot.microsoft.com") return "copilot";
  return null;
}

function cleanKey(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9_-]{1,256}$/.test(text) ? text : null;
}

function identity(provider, kind, routeClass, threadKey, provisional, writable) {
  return Object.freeze({ provider, kind, routeClass, threadKey, provisional, writable });
}

export function deriveConversationIdentity(rawUrl) {
  let url;
  try { url = new URL(String(rawUrl || "")); }
  catch (_) { return null; }

  const provider = providerFromHost(url.hostname);
  if (!provider || !SUPPORTED.has(provider)) return null;
  const parts = (url.pathname || "/").split("/").filter(Boolean);

  if (provider === "chatgpt") {
    if (parts[0] === "share" && cleanKey(parts[1])) return identity(provider, "share", "share", cleanKey(parts[1]), false, false);
    if (parts[0] === "c" && cleanKey(parts[1])) return identity(provider, "conversation", "conversation", cleanKey(parts[1]), false, true);
    if (parts.length === 0) return identity(provider, "surface", "home", null, true, true);
    return identity(provider, "unknown", "unsupported", null, true, false);
  }

  if (provider === "grok") {
    if (parts[0] === "share" && cleanKey(parts[1])) return identity(provider, "share", "share", cleanKey(parts[1]), false, false);
    if (parts[0] === "c" && cleanKey(parts[1])) return identity(provider, "conversation", "conversation", cleanKey(parts[1]), false, true);
    if (parts.length === 0) return identity(provider, "surface", "home", null, true, true);
    return identity(provider, "unknown", "unsupported", null, true, false);
  }

  // No reviewed stable writable thread-key route is packaged yet for these
  // providers. Unknown routes therefore stay non-authoritative/fail-closed.
  return identity(provider, "unknown", "unverified", null, true, false);
}

export function sameConversationIdentity(a, b) {
  if (!a || !b) return false;
  return a.provider === b.provider &&
    a.kind === b.kind &&
    a.routeClass === b.routeClass &&
    a.threadKey === b.threadKey &&
    Boolean(a.provisional) === Boolean(b.provisional) &&
    Boolean(a.writable) === Boolean(b.writable);
}

export function classifyIdentityTransition(previous, current) {
  if (!previous || !current) return "IDENTITY_UNAVAILABLE";
  if (previous.provider !== current.provider) return "PROVIDER_MISMATCH";
  if (sameConversationIdentity(previous, current)) return "IDENTITY_UNCHANGED";
  if (current.kind === "share" || current.writable !== true) return "READ_ONLY_SHARE";
  if (current.kind === "surface" && current.provisional === true) return "NEW_CHAT_SURFACE";
  if (current.kind === "conversation" && current.provisional !== true) return "NEW_CONVERSATION_CONFIRMED";
  return "IDENTITY_UNSUPPORTED";
}

export const PROVIDER_POLICY = Object.freeze({
  chatgpt: Object.freeze({ allowStableSurfaceConversation: false }),
  grok: Object.freeze({ allowStableSurfaceConversation: false }),
  claude: Object.freeze({ allowStableSurfaceConversation: false }),
  gemini: Object.freeze({ allowStableSurfaceConversation: false }),
  copilot: Object.freeze({ allowStableSurfaceConversation: false })
});

export function buildIdentityChangedEvent(previousIdentity, currentIdentity, health = null) {
  return Object.freeze({
    type: "AI_BRIDGE_CONVERSATION_IDENTITY_CHANGED",
    previousIdentity: previousIdentity ? { ...previousIdentity } : null,
    currentIdentity: currentIdentity ? { ...currentIdentity } : null,
    health: health && typeof health === "object" ? {
      state: String(health.state || ""),
      reason: String(health.reason || "").slice(0, 160)
    } : null
  });
}

export function createDispatchCache({ maxEntries = 32 } = {}) {
  const limit = Number.isInteger(maxEntries) && maxEntries > 0 ? maxEntries : 32;
  const records = new Map();
  return Object.freeze({
    lookup(dispatchId) {
      return records.get(String(dispatchId || "")) || null;
    },
    accept({ dispatchId, identityAtAcceptance, generation, result, expectedTransition = false }) {
      const id = String(dispatchId || "").trim();
      if (!id) return { ok: false, reason: "missing-dispatch-id" };
      const existing = records.get(id);
      if (existing) {
        const sameIdentity = sameConversationIdentity(existing.identityAtAcceptance, identityAtAcceptance);
        const sameGeneration = Number(existing.generation) === Number(generation);
        if (sameIdentity && sameGeneration) return { ok: true, duplicate: true, result: existing.result };
        if (!expectedTransition) return { ok: false, reason: "dispatch-context-mismatch" };
        if (!sameGeneration) return { ok: false, reason: "dispatch-generation-mismatch" };
        if (!existing.identityAtAcceptance || !identityAtAcceptance || existing.identityAtAcceptance.provider !== identityAtAcceptance.provider) {
          return { ok: false, reason: "dispatch-provider-mismatch" };
        }
        const transition = classifyIdentityTransition(existing.identityAtAcceptance, identityAtAcceptance);
        if (!["NEW_CHAT_SURFACE", "NEW_CONVERSATION_CONFIRMED"].includes(transition)) {
          return { ok: false, reason: "dispatch-transition-not-authorized" };
        }
      }
      const record = Object.freeze({ dispatchId: id, identityAtAcceptance: identityAtAcceptance ? { ...identityAtAcceptance } : null, generation: Number(generation), result });
      records.delete(id);
      records.set(id, record);
      while (records.size > limit) records.delete(records.keys().next().value);
      return { ok: true, duplicate: false, result };
    },
    size() { return records.size; }
  });
}
