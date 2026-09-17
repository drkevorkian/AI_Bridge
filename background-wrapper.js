// AI Bridge service-worker bootstrap.
//
// Install mutation serialization before background.js registers coordinator
// listeners. Message-driven control actions, tab-close recovery, and watchdog
// recovery must all share this one queue.
importScripts("coordinator-mutex-prelude.js");
if (
  globalThis.__AI_BRIDGE_COORDINATOR_MUTEX__?.version !== 5 ||
  globalThis.__AI_BRIDGE_COORDINATOR_MUTEX__?.artifactProvenanceGate !== true ||
  typeof globalThis.enqueueCoordinatorMutation !== "function"
) {
  throw new Error("AI Bridge coordinator mutex failed to initialize.");
}

// Enforce the worker's network credential boundary before any coordinator source
// is evaluated. Even stale or accidentally reordered code cannot attach ambient
// browser cookies/HTTP auth to an HTTP(S) fetch. Explicit Authorization headers
// (used by the Google API client) are unaffected.
importScripts("worker-fetch-security-prelude.js");
if (globalThis.__AI_BRIDGE_WORKER_FETCH_SECURITY_V1__?.httpCredentials !== "omit") {
  throw new Error("AI Bridge worker fetch credential guard failed to initialize.");
}

// Load the coordinator core by itself. background.js retains legacy helper
// declarations for source compatibility, but privileged implementations are
// replaced synchronously before Chrome can dispatch extension events.
importScripts("background.js");

importScripts("artifact-fetch-runtime-hardening.js");
if (
  globalThis.__AI_BRIDGE_ARTIFACT_FETCH_SECURITY__?.credentials !== "omit" ||
  globalThis.__AI_BRIDGE_ARTIFACT_FETCH_SECURITY__?.finalUrlRevalidation !== true ||
  globalThis.__AI_BRIDGE_ARTIFACT_FETCH_SECURITY__?.streamedSizeLimit !== true
) {
  throw new Error("AI Bridge artifact security hardening failed to initialize.");
}

// Update check and download are pinned to one immutable Git commit SHA so a
// moving main branch cannot create a check/download time-of-check race.
importScripts("update-runtime-hardening.js");
if (globalThis.__AI_BRIDGE_UPDATE_HARDENING_V1__?.immutableCommitPin !== true) {
  throw new Error("AI Bridge immutable update hardening failed to initialize.");
}

// Established helpers load only after privileged network paths are hardened.
importScripts("completion-runtime-hardening.js", "oauth-runtime-hardening.js", "power.js");

// Focus is a third dashboard layout. Extend the existing cloud-settings layout
// allowlist without weakening the sanitizer that reconstructs synced settings.
importScripts("focus-runtime-hardening.js");
if (globalThis.__AI_BRIDGE_FOCUS_RUNTIME_V1__?.cloudLayoutAllowed !== true) {
  throw new Error("AI Bridge Focus layout hardening failed to initialize.");
}

// Never submit a replacement prompt while the provider still reports that the
// previous generation is active. This protects RESEND, recovery, and future
// send call sites with one fail-closed overlap invariant.
importScripts("resend-runtime-hardening.js");
if (globalThis.__AI_BRIDGE_RESEND_HARDENING_V1__?.stopBeforeReplacement !== true) {
  throw new Error("AI Bridge resend hardening failed to initialize.");
}

// Manual relay is recovery-only and may commit a provider response directly.
importScripts("manual-relay-runtime-hardening.js");
if (globalThis.__AI_BRIDGE_MANUAL_RELAY_HARDENING_V1__?.rejectsStreamingCapture !== true) {
  throw new Error("AI Bridge manual-relay hardening failed to initialize.");
}

// Fail closed on response generations after the core functions exist.
importScripts("coordinator-generation-hardening.js");
if (globalThis.__AI_BRIDGE_GENERATION_SECURITY__?.failClosedWhenUnarmed !== true) {
  throw new Error("AI Bridge generation hardening failed to initialize.");
}

// Human-input detection is a control-plane concern.
importScripts("human-input-runtime-hardening.js");

// Watchdog recovery must examine only agents that are expected to be generating,
// must not treat `pendingSend` as model progress, and must serialize recovery
// mutations through the same coordinator queue as model responses.
importScripts("watchdog-runtime-hardening.js");
if (
  globalThis.__AI_BRIDGE_WATCHDOG_SECURITY__?.pendingSendCountsAsModelProgress !== false ||
  globalThis.__AI_BRIDGE_WATCHDOG_SECURITY__?.serializedWithCoordinator !== true ||
  globalThis.__AI_BRIDGE_WATCHDOG_SECURITY__?.mutatesActiveSides !== false
) {
  throw new Error("AI Bridge watchdog hardening failed to initialize.");
}

// Reconnect recovery is isolated from the coordinator.
importScripts("reconnect-runtime-hardening.js");
