(() => {
  "use strict";

  // PR 1 security boundary for artifact relay fetches.
  //
  // The provider page controls the DOM link that eventually reaches this
  // function, so treat every candidate URL as attacker-controlled. The
  // service worker must never attach browser credentials to that request.
  // Signed/public artifact URLs still work because their authorization is in
  // the URL itself; authenticated same-origin downloads are attempted in the
  // provider page first by content.js before this fallback is used.
  const FLAG = "__AI_BRIDGE_ARTIFACT_FETCH_HARDENING_V1__";
  if (globalThis[FLAG]) return;
  globalThis[FLAG] = true;

  const MAX_FILE_BYTES = 12 * 1024 * 1024;
  const FETCH_TIMEOUT_MS = 20000;

  const EXACT_HOSTS = new Set([
    "chatgpt.com",
    "chat.openai.com",
    "grok.com",
    "assets.grok.com",
    "assets.grokusercontent.com",
    "claude.ai",
    "gemini.google.com",
    "copilot.microsoft.com",
    "x.ai",
    "api.x.ai"
  ]);

  // These are provider-controlled asset families used for generated/downloaded
  // files. Keep the list intentionally short; do not add general-purpose
  // parent domains such as *.microsoft.com or *.x.ai here.
  const HOST_SUFFIXES = Object.freeze([
    ".oaiusercontent.com",
    ".googleusercontent.com",
    ".anthropic.com"
  ]);

  function hardenedArtifactFetchHostAllowed(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ""));
      if (url.protocol !== "https:") return false;
      if (url.username || url.password) return false;
      if (url.port && url.port !== "443") return false;

      const host = url.hostname.toLowerCase();
      if (!host || host.includes("..")) return false;
      if (EXACT_HOSTS.has(host)) return true;
      return HOST_SUFFIXES.some(suffix => host.length > suffix.length && host.endsWith(suffix));
    } catch (_) {
      return false;
    }
  }

  function sanitizeName(raw, fallback = "artifact.bin") {
    const value = String(raw || fallback).replace(/[\\/\0]/g, "_").trim();
    return (value || fallback).slice(0, 240);
  }

  function encodeBase64(bytes) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < view.length; i += CHUNK) {
      binary += String.fromCharCode(...view.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  async function hardenedFetchArtifactInBackground(rawUrl, name = "artifact.bin", mime = "") {
    const requestedUrl = String(rawUrl || "");
    if (!hardenedArtifactFetchHostAllowed(requestedUrl)) {
      throw new Error("Artifact URL host is not permitted by AI Bridge.");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      // IMPORTANT: do not use credentials:"include" here. A model-controlled
      // link must not be able to turn AI Bridge into an authenticated request
      // primitive against a provider or sibling service.
      //
      // redirect:"manual" cannot be used for hop inspection: Fetch returns an
      // opaque redirect for cross-origin manual redirects, hiding Location.
      // We therefore follow using Chrome's normal host-permission boundary,
      // send no credentials/referrer, and reject the result unless the final
      // URL remains on the explicit artifact allowlist.
      const response = await fetch(requestedUrl, {
        credentials: "omit",
        redirect: "follow",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        signal: controller.signal
      });

      if (!hardenedArtifactFetchHostAllowed(response.url)) {
        throw new Error("Artifact fetch redirected off the HTTPS allowlist.");
      }
      if (!response.ok) throw new Error(`Artifact fetch failed with HTTP ${response.status}.`);

      const declared = Number(response.headers.get("content-length") || 0);
      if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) {
        throw new Error("Artifact exceeds the per-file relay limit.");
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length || bytes.byteLength > MAX_FILE_BYTES) {
        throw new Error("Artifact is empty or too large.");
      }

      return {
        name: sanitizeName(name, "artifact.bin"),
        mime: String(mime || response.headers.get("content-type") || "application/octet-stream").slice(0, 160),
        size: bytes.byteLength,
        dataBase64: encodeBase64(bytes)
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // background.js is a classic service-worker script, so its top-level
  // function declarations are replaceable through the shared global binding.
  // Replace only these two artifact primitives; OAuth, GitHub update fetches,
  // and every coordinator state machine remain untouched.
  globalThis.artifactFetchHostAllowed = hardenedArtifactFetchHostAllowed;
  globalThis.fetchArtifactInBackground = hardenedFetchArtifactInBackground;

  globalThis.__AI_BRIDGE_ARTIFACT_FETCH_SECURITY__ = Object.freeze({
    version: 1,
    credentials: "omit",
    finalUrlRevalidation: true
  });
})();
