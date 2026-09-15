// AI Bridge service-worker bootstrap.
//
// Keep the existing background.js runtime intact and load auxiliary runtime
// modules after it. This lets small, isolated platform/security features stay
// auditable without inflating the already-large coordination engine.
importScripts(
  "background.js",
  "human-input-runtime-hardening.js",
  "completion-runtime-hardening.js",
  "oauth-runtime-hardening.js",
  "power.js"
);
