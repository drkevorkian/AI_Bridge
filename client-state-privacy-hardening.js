// AI Bridge client-state privacy hardening.
//
// The coordinator keeps viewpoint provenance internally so queued/retried sends
// and committed responses can be validated against the exact bound tab/thread.
// Dashboard/popup state consumers do not need those worker-only identifiers.
// Redact them only from clientStateSnapshot() output while preserving the real
// in-memory/persisted state and the functional tabA..tabE bindings required by
// the dashboard tab selectors.
(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_CLIENT_STATE_PRIVACY_V1__";
  if (globalThis[FLAG]) return;

  if (typeof clientStateSnapshot !== "function") {
    throw new Error("Client-state privacy hardening requires clientStateSnapshot().");
  }

  const SENSITIVE_TRANSCRIPT_FIELDS = Object.freeze([
    "provenanceId",
    "threadKey",
    "boundTabId"
  ]);

  function redactTranscriptEntry(entry) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const copy = { ...entry };
    for (const key of SENSITIVE_TRANSCRIPT_FIELDS) delete copy[key];
    return copy;
  }

  function redactClientSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return snapshot;
    const safe = { ...snapshot };

    // viewpointIdentityBySide contains the same raw tab/thread/provenance tuple
    // used by worker-side dispatch validation. It has no dashboard rendering or
    // control purpose, so never expose it through AI_BRIDGE_GET_STATE.
    delete safe.viewpointIdentityBySide;

    if (Array.isArray(snapshot.transcript)) {
      safe.transcript = snapshot.transcript.map(redactTranscriptEntry);
    }
    return safe;
  }

  const baseClientStateSnapshot = clientStateSnapshot;
  clientStateSnapshot = function privacyHardenedClientStateSnapshot(options) {
    return redactClientSnapshot(baseClientStateSnapshot(options));
  };

  globalThis[FLAG] = Object.freeze({
    version: 1,
    redactsViewpointIdentityMap: true,
    redactsTranscriptViewpointIdentity: true,
    preservesFunctionalBindingTabIds: true,
    redactClientSnapshot
  });
})();
