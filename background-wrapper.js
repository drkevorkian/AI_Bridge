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
  globalThis.__AI_BRIDGE_AGENT_CAPABILITIES__?.duplicateProviderAgentsEnabled !== true
) {
  throw new Error("AI Bridge agent capability contract failed to initialize.");
}

importScripts("coordinator-mutex-prelude.js");
if (
  globalThis.__AI_BRIDGE_COORDINATOR_MUTEX__?.version !== 6 ||
  globalThis.__AI_BRIDGE_COORDINATOR_MUTEX__?.artifactProvenanceGate !== true ||
  globalThis.__AI_BRIDGE_COORDINATOR_MUTEX__?.artifactProvenanceSupportsDynamicSides !== true ||
  globalThis.__AI_BRIDGE_COORDINATOR_MUTEX__?.manualCaptureBypassesArmedGeneration !== true ||
  globalThis.__AI_BRIDGE_COORDINATOR_MUTEX__?.serializesTabRemovalLifecycle !== true ||
  globalThis.__AI_BRIDGE_COORDINATOR_MUTEX__?.serializesTabReplacementLifecycle !== true ||
  globalThis.__AI_BRIDGE_COORDINATOR_MUTEX__?.serializesAgentCountMutation !== true ||
  globalThis.__AI_BRIDGE_COORDINATOR_MUTEX__?.serializesIdleStateMutations !== true ||
  globalThis.__AI_BRIDGE_COORDINATOR_MUTEX__?.serializesClientStateReads !== true ||
  typeof globalThis.enqueueCoordinatorMutation !== "function"
) {
  throw new Error("AI Bridge coordinator mutex failed to initialize.");
}

importScripts("worker-fetch-security-prelude.js");
if (globalThis.__AI_BRIDGE_WORKER_FETCH_SECURITY_V1__?.httpCredentials !== "omit") {
  throw new Error("AI Bridge worker fetch credential guard failed to initialize.");
}

importScripts("artifact-request-authority-prelude.js");
if (
  globalThis.__AI_BRIDGE_ARTIFACT_REQUEST_AUTHORITY_V1__?.version !== 1 ||
  globalThis.__AI_BRIDGE_ARTIFACT_REQUEST_AUTHORITY_V1__?.automaticRequiresArmedGeneration !== true ||
  globalThis.__AI_BRIDGE_ARTIFACT_REQUEST_AUTHORITY_V1__?.automaticRequiresDispatchConversation !== true ||
  globalThis.__AI_BRIDGE_ARTIFACT_REQUEST_AUTHORITY_V1__?.manualCaptureAllowsProvenanceRefresh !== true ||
  globalThis.__AI_BRIDGE_ARTIFACT_REQUEST_AUTHORITY_V1__?.pageIdentityRemainsWorkerPrivate !== true ||
  typeof globalThis.aiBridgeAuthorizeArtifactRequest !== "function"
) {
  throw new Error("AI Bridge artifact request authority guard failed to initialize.");
}

importScripts("background.js");

importScripts("coordinator-dynamic-agents.js");
if (
  globalThis.__AI_BRIDGE_DYNAMIC_AGENTS_V1__?.version !== 1 ||
  globalThis.__AI_BRIDGE_DYNAMIC_AGENTS_V1__?.uniqueTabBinding !== true ||
  globalThis.__AI_BRIDGE_DYNAMIC_AGENTS_V1__?.duplicateProviderAgentsEnabled !== true ||
  globalThis.__AI_BRIDGE_DYNAMIC_AGENTS_V1__?.revokesRetiredTabAuthority !== true ||
  globalThis.__AI_BRIDGE_DYNAMIC_AGENTS_V1__?.pausesOnBoundTabReplacement !== true ||
  globalThis.__AI_BRIDGE_DYNAMIC_AGENTS_V1__?.neverAutoTrustsReplacementTab !== true
) {
  throw new Error("AI Bridge dynamic-agent coordinator failed to initialize.");
}

importScripts("dynamic-state-restart-hardening.js");
if (
  globalThis.__AI_BRIDGE_DYNAMIC_RESTART_HYDRATION_V1__?.version !== 1 ||
  globalThis.__AI_BRIDGE_DYNAMIC_RESTART_HYDRATION_V1__?.restoresPersistedMainSide !== true ||
  globalThis.__AI_BRIDGE_DYNAMIC_RESTART_HYDRATION_V1__?.restoresPersistedPhaseLists !== true ||
  globalThis.__AI_BRIDGE_DYNAMIC_RESTART_HYDRATION_V1__?.restoresPersistedCycleParticipants !== true ||
  globalThis.__AI_BRIDGE_DYNAMIC_RESTART_HYDRATION_V1__?.restoresServiceWorkerQueue !== false
) {
  throw new Error("AI Bridge dynamic restart hydration failed to initialize.");
}

importScripts("coordinator-dynamic-semantics.js");
if (
  globalThis.__AI_BRIDGE_DYNAMIC_SEMANTICS_V1__?.version !== 2 ||
  globalThis.__AI_BRIDGE_DYNAMIC_SEMANTICS_V1__?.liveRosterMeshTargets !== true ||
  globalThis.__AI_BRIDGE_DYNAMIC_SEMANTICS_V1__?.derivedTurnMinimums !== true ||
  globalThis.__AI_BRIDGE_DYNAMIC_SEMANTICS_V1__?.cloudJobsThroughE !== true
) {
  throw new Error("AI Bridge dynamic-agent semantics failed to initialize.");
}

importScripts("provider-health-runtime.js");
if (
  globalThis.__AI_BRIDGE_PROVIDER_HEALTH_V1__?.version !== 1 ||
  globalThis.__AI_BRIDGE_PROVIDER_HEALTH_V1__?.uniqueTabBinding !== true ||
  globalThis.__AI_BRIDGE_PROVIDER_HEALTH_V1__?.includesSanitizedThreadIdentity !== true ||
  globalThis.__AI_BRIDGE_PROVIDER_HEALTH_V1__?.detectsDuplicateThreads !== true ||
  globalThis.__AI_BRIDGE_PROVIDER_HEALTH_V1__?.stateKeyedProbeCache !== true ||
  globalThis.__AI_BRIDGE_PROVIDER_HEALTH_V1__?.tabLifecycleInvalidatesProbeCache !== true ||
  globalThis.__AI_BRIDGE_PROVIDER_HEALTH_V1__?.rejectsUnstableInflightProbes !== true ||
  globalThis.__AI_BRIDGE_PROVIDER_HEALTH_V1__?.publicHealthRedactsSensitiveIdentity !== true ||
  globalThis.__AI_BRIDGE_PROVIDER_HEALTH_V1__?.mutatesRouting !== false ||
  globalThis.__AI_BRIDGE_PROVIDER_HEALTH_V1__?.sendsProviderPrompts !== false
) {
  throw new Error("AI Bridge provider health monitor failed to initialize.");
}

importScripts("start-provider-health-hardening.js");
if (
  globalThis.__AI_BRIDGE_START_PROVIDER_HEALTH_GATE_V1__?.version !== 1 ||
  globalThis.__AI_BRIDGE_START_PROVIDER_HEALTH_GATE_V1__?.backendStartRequiresReadyProviders !== true ||
  globalThis.__AI_BRIDGE_START_PROVIDER_HEALTH_GATE_V1__?.probesAfterFreshChatReset !== true ||
  globalThis.__AI_BRIDGE_START_PROVIDER_HEALTH_GATE_V1__?.restoresPersistedStateOnRejectedFreshStart !== true ||
  globalThis.__AI_BRIDGE_START_PROVIDER_HEALTH_GATE_V1__?.doesNotSendProviderPrompts !== true
) {
  throw new Error("AI Bridge backend start Provider Health gate failed to initialize.");
}

importScripts("viewpoint-runtime.js");
if (
  globalThis.__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__?.version !== 1 ||
  globalThis.__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__?.stampsTranscript !== true ||
  globalThis.__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__?.stampsBeforeCommitSave !== true ||
  globalThis.__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__?.capturesIdentityBeforeDispatch !== true ||
  globalThis.__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__?.failsClosedWithoutDispatchIdentityWhenEnabled !== true ||
  globalThis.__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__?.serializesSameFamilySends !== true ||
  globalThis.__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__?.revalidatesIdentityAtDispatch !== true ||
  globalThis.__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__?.cancelsQueuedOnTabClose !== true ||
  globalThis.__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__?.cancelsQueuedOnTabReplace !== true ||
  globalThis.__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__?.restoresQueuedSendsAfterWorkerRestart !== false ||
  globalThis.__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__?.clearsTransientIdentityOnDispatchFailure !== true ||
  globalThis.__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__?.queueTelemetryReadOnly !== true ||
  globalThis.__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__?.queueTelemetryEphemeral !== true ||
  globalThis.__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__?.queueTelemetryContainsSensitiveIdentity !== false ||
  globalThis.__AI_BRIDGE_VIEWPOINT_RUNTIME_V1__?.enablesDuplicateProviders !== true
) {
  throw new Error("AI Bridge viewpoint runtime failed to initialize.");
}

importScripts("client-state-privacy-hardening.js");
if (
  globalThis.__AI_BRIDGE_CLIENT_STATE_PRIVACY_V1__?.version !== 1 ||
  globalThis.__AI_BRIDGE_CLIENT_STATE_PRIVACY_V1__?.redactsViewpointIdentityMap !== true ||
  globalThis.__AI_BRIDGE_CLIENT_STATE_PRIVACY_V1__?.redactsTranscriptViewpointIdentity !== true ||
  globalThis.__AI_BRIDGE_CLIENT_STATE_PRIVACY_V1__?.preservesFunctionalBindingTabIds !== true
) {
  throw new Error("AI Bridge client-state privacy hardening failed to initialize.");
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
if (
  globalThis.__AI_BRIDGE_MANUAL_RELAY_HARDENING_V1__?.rejectsStreamingCapture !== true ||
  globalThis.__AI_BRIDGE_MANUAL_RELAY_HARDENING_V1__?.refreshesViewpointProvenanceFromCapturedUrl !== true ||
  globalThis.__AI_BRIDGE_MANUAL_RELAY_HARDENING_V1__?.requiresCapturePageUrl !== true
) {
  throw new Error("AI Bridge manual-relay hardening failed to initialize.");
}

importScripts("coordinator-generation-hardening.js");
if (
  globalThis.__AI_BRIDGE_GENERATION_SECURITY__?.version !== 5 ||
  globalThis.__AI_BRIDGE_GENERATION_SECURITY__?.failClosedWhenUnarmed !== true ||
  globalThis.__AI_BRIDGE_GENERATION_SECURITY__?.durablyArmsGenerationBeforeProviderSend !== true ||
  globalThis.__AI_BRIDGE_GENERATION_SECURITY__?.providerSendBoundaryGuarded !== true ||
  globalThis.__AI_BRIDGE_GENERATION_SECURITY__?.rechecksArmedGenerationAfterPersistence !== true ||
  globalThis.__AI_BRIDGE_GENERATION_SECURITY__?.durablyClearsFailedDispatchGeneration !== true ||
  globalThis.__AI_BRIDGE_GENERATION_SECURITY__?.rechecksGenerationAtSerializedCommit !== true ||
  globalThis.__AI_BRIDGE_GENERATION_SECURITY__?.consumesAcceptedGenerationBeforeCommit !== true ||
  globalThis.__AI_BRIDGE_GENERATION_SECURITY__?.durablyPersistsConsumedGenerationBeforeCommit !== true ||
  globalThis.__AI_BRIDGE_GENERATION_SECURITY__?.preservesNewerGenerationArmedByCommit !== true ||
  globalThis.__AI_BRIDGE_GENERATION_SECURITY__?.preventsSequentialReplayWindow !== true ||
  globalThis.__AI_BRIDGE_GENERATION_SECURITY__?.preventsRestartGenerationResurrection !== true ||
  globalThis.__AI_BRIDGE_GENERATION_SECURITY__?.requiresAutomaticResponsePageIdentity !== true ||
  globalThis.__AI_BRIDGE_GENERATION_SECURITY__?.rejectsCrossThreadSpaResponseBeforeConsumption !== true
) {
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
