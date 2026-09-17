// AI Bridge service-worker bootstrap.
//
// Load the shared logical-agent/provider capability contract before the
// coordinator. The migration initially keeps the existing A/B/C routing intact,
// but every later dynamic-agent layer consumes this one audited provider limit.
importScripts("agent-capabilities.js");
if (
  globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__?.version !== 1 ||
  globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__?.maxUniqueProviderAgents !== 5 ||
  globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__?.uniqueTabBindingNeverRelaxed !== true ||
  globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__?.distinctThreadRequiredWhenSameFamily !== true ||
  globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__?.serializeSameFamilySends !== true ||
  globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__?.duplicateProviderAgentsEnabled !== false
) {
  throw new Error("AI Bridge agent capability contract failed to initialize.");
}

importScripts("coordinator-mutex-prelude.js");
if (
  globalThis.__AI_BRIDGE_COORDINATOR_MUTEX__?.version !== 5 ||
  globalThis.__AI_BRIDGE_COORDINATOR_MUTEX__?.artifactProvenanceGate !== true ||
  typeof globalThis.enqueueCoordinatorMutation !== "function"
) {
  throw new Error("AI Bridge coordinator mutex failed to initialize.");
}

importScripts("worker-fetch-security-prelude.js");
if (globalThis.__AI_BRIDGE_WORKER_FETCH_SECURITY_V1__?.httpCredentials !== "omit") {
  throw new Error("AI Bridge worker fetch credential guard failed to initialize.");
}

importScripts("background.js");

importScripts("coordinator-dynamic-agents.js");
if (
  globalThis.__AI_BRIDGE_DYNAMIC_AGENTS_V1__?.version !== 1 ||
  globalThis.__AI_BRIDGE_DYNAMIC_AGENTS_V1__?.uniqueTabBinding !== true
) {
  throw new Error("AI Bridge dynamic-agent coordinator failed to initialize.");
}

importScripts("coordinator-dynamic-semantics.js");
if (
  globalThis.__AI_BRIDGE_DYNAMIC_SEMANTICS_V1__?.version !== 1 ||
  globalThis.__AI_BRIDGE_DYNAMIC_SEMANTICS_V1__?.derivedTurnMinimums !== true ||
  globalThis.__AI_BRIDGE_DYNAMIC_SEMANTICS_V1__?.cloudJobsThroughE !== true
) {
  throw new Error("AI Bridge dynamic-agent semantics failed to initialize.");
}

importScripts("provider-health-runtime.js");
if (
  globalThis.__AI_BRIDGE_PROVIDER_HEALTH_V1__?.version !== 1 ||
  globalThis.__AI_BRIDGE_PROVIDER_HEALTH_V1__?.uniqueTabBinding !== true ||
  globalThis.__AI_BRIDGE_PROVIDER_HEALTH_V1__?.mutatesRouting !== false ||
  globalThis.__AI_BRIDGE_PROVIDER_HEALTH_V1__?.sendsProviderPrompts !== false
) {
  throw new Error("AI Bridge provider health monitor failed to initialize.");
}

importScripts("viewpoint-runtime.js");
if (
  globalThis.__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__?.version !== 1 ||
  globalThis.__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__?.stampsTranscript !== true ||
  globalThis.__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__?.serializesSameFamilySends !== true ||
  globalThis.__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__?.enablesDuplicateProviders !== false
) {
  throw new Error("AI Bridge viewpoint runtime failed to initialize.");
}

importScripts("artifact-fetch-runtime-hardening.js");
if (
  globalThis.__AI_BRIDGE_ARTIFACT_FETCH_SECURITY__?.credentials !== "omit" ||
  globalThis.__AI_BRIDGE_ARTIFACT_FETCH_SECURITY__?.finalUrlRevalidation !== true ||
  globalThis.__AI_BRIDGE_ARTIFACT_FETCH_SECURITY__?.streamedSizeLimit !== true
) {
  throw new Error("AI Bridge artifact security hardening failed to initialize.");
}

importScripts("update-runtime-hardening.js");
if (globalThis.__AI_BRIDGE_UPDATE_HARDENING_V1__?.immutableCommitPin !== true) {
  throw new Error("AI Bridge immutable update hardening failed to initialize.");
}

importScripts("completion-runtime-hardening.js", "oauth-runtime-hardening.js", "power.js");

importScripts("focus-runtime-hardening.js");
if (globalThis.__AI_BRIDGE_FOCUS_RUNTIME_V1__?.cloudLayoutAllowed !== true) {
  throw new Error("AI Bridge Focus layout hardening failed to initialize.");
}

importScripts("resend-runtime-hardening.js");
if (globalThis.__AI_BRIDGE_RESEND_HARDENING_V1__?.stopBeforeReplacement !== true) {
  throw new Error("AI Bridge resend hardening failed to initialize.");
}

importScripts("manual-relay-runtime-hardening.js");
if (globalThis.__AI_BRIDGE_MANUAL_RELAY_HARDENING_V1__?.rejectsStreamingCapture !== true) {
  throw new Error("AI Bridge manual-relay hardening failed to initialize.");
}

importScripts("coordinator-generation-hardening.js");
if (globalThis.__AI_BRIDGE_GENERATION_SECURITY__?.failClosedWhenUnarmed !== true) {
  throw new Error("AI Bridge generation hardening failed to initialize.");
}

importScripts("human-input-runtime-hardening.js");

importScripts("watchdog-runtime-hardening.js");
if (
  globalThis.__AI_BRIDGE_WATCHDOG_SECURITY__?.pendingSendCountsAsModelProgress !== false ||
  globalThis.__AI_BRIDGE_WATCHDOG_SECURITY__?.serializedWithCoordinator !== true ||
  globalThis.__AI_BRIDGE_WATCHDOG_SECURITY__?.mutatesActiveSides !== false
) {
  throw new Error("AI Bridge watchdog hardening failed to initialize.");
}

importScripts("reconnect-runtime-hardening.js");
