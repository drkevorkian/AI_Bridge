// AI Bridge service-worker bootstrap.
//
// Keep the existing background.js runtime intact and load auxiliary runtime
// modules after it. This lets small, isolated platform/security features stay
// auditable without inflating the already-large coordination engine.
importScripts("background.js", "completion-runtime-hardening.js", "oauth-runtime-hardening.js", "power.js");

// Human-input detection is a control-plane concern. Load its isolated hardening
// after the established bootstrap chain so existing runtime ordering and older
// extension/test assumptions remain backwards compatible.
importScripts("human-input-runtime-hardening.js");

// Reconnect recovery is also isolated from the coordinator. It replaces only
// ensureTabListener() so service-worker restarts and extension reloads rebuild
// the complete content runtime before resuming a session.
importScripts("reconnect-runtime-hardening.js");
