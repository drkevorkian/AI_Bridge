// AI Bridge service-worker bootstrap.
//
// Install the mutation-serialization prelude before background.js registers its
// listeners. This lets the coordinator's existing anonymous message listener,
// tab-close recovery, and alarm-driven watchdog recovery share one queue without
// rewriting the large coordinator core.
importScripts("coordinator-mutex-prelude.js");
if (
  globalThis.__AI_BRIDGE_COORDINATOR_MUTEX__?.version !== 4 ||
  typeof globalThis.enqueueCoordinatorMutation !== "function"
) {
  throw new Error("AI Bridge coordinator mutex failed to initialize.");
}

// Keep the existing background.js runtime intact and load established helpers.
importScripts("background.js", "completion-runtime-hardening.js", "oauth-runtime-hardening.js", "power.js");

// Never submit a replacement prompt while the provider still reports that the
// previous generation is active. This protects RESEND, recovery, and future
// send call sites with one fail-closed overlap invariant.
importScripts("resend-runtime-hardening.js");
if (globalThis.__AI_BRIDGE_RESEND_HARDENING_V1__?.stopBeforeReplacement !== true) {
  throw new Error("AI Bridge resend hardening failed to initialize.");
}

// Artifact relay URLs come from provider DOM and are therefore untrusted.
importScripts("artifact-fetch-runtime-hardening.js");
if (globalThis.__AI_BRIDGE_ARTIFACT_FETCH_SECURITY__?.credentials !== "omit") {
  throw new Error("AI Bridge artifact security hardening failed to initialize.");
}

// Manual relay is recovery-only and may commit a provider response directly.
// Refuse incomplete/streaming captures before that path can mutate state.
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
