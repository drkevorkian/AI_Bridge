(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_FOCUS_RUNTIME_V1__";
  if (globalThis[FLAG]) return;

  if (!(ALLOWED_CLOUD_LAYOUTS instanceof Set)) {
    throw new Error("AI Bridge Focus layout could not attach to the cloud layout allowlist.");
  }

  // The core sanitizer intentionally reconstructs settings from allowlists.
  // Extend that existing Set rather than replacing/loosening the sanitizer.
  ALLOWED_CLOUD_LAYOUTS.add("focus");

  globalThis[FLAG] = Object.freeze({
    version: 1,
    cloudLayoutAllowed: ALLOWED_CLOUD_LAYOUTS.has("focus")
  });
})();
