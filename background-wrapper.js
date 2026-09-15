// AI Bridge service-worker bootstrap.
//
// Install the mutation-serialization prelude before background.js registers its
// listeners. This lets the coordinator's existing anonymous message listener
// run behind one queue without rewriting the large core file.
importScripts("coordinator-mutex-prelude.js");
if (!globalThis.__AI_BRIDGE_COORDINATOR_MUTEX__) {
  throw new Error("AI Bridge coordinator mutex failed to initialize.");
}

// Keep the existing background.js runtime intact and load established helpers.
importScripts("background.js", "completion-runtime-hardening.js", "oauth-runtime-hardening.js", "power.js");

// Artifact relay URLs come from provider DOM and are therefore untrusted.
importScripts("artifact-fetch-runtime-hardening.js");
if (globalThis.__AI_BRIDGE_ARTIFACT_FETCH_SECURITY__?.credentials !== "omit") {
  throw new Error("AI Bridge artifact security hardening failed to initialize.");
}

// Fail closed on response generations after the core functions exist.
importScripts("coordinator-generation-hardening.js");
if (globalThis.__AI_BRIDGE_GENERATION_SECURITY__?.failClosedWhenUnarmed !== true) {
  throw new Error("AI Bridge generation hardening failed to initialize.");
}

// Human-input detection is a control-plane concern.
importScripts("human-input-runtime-hardening.js");

// Reconnect recovery is isolated from the coordinator.
importScripts("reconnect-runtime-hardening.js");
