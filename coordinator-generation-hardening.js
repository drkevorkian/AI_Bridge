(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_GENERATION_HARDENING_V1__";
  if (globalThis[FLAG]) return;
  globalThis[FLAG] = true;

  // Responses are valid only when both sides present the same non-empty
  // generation ID. During START/RESUME setup the coordinator therefore cannot
  // accidentally accept leftover DOM output from a previous generation.
  generationMatches = function hardenedGenerationMatches(expectedId, incomingId) {
    const expected = String(expectedId || "");
    const incoming = String(incomingId || "");
    return Boolean(expected && incoming && incoming === expected);
  };

  globalThis.__AI_BRIDGE_GENERATION_SECURITY__ = Object.freeze({
    version: 1,
    failClosedWhenUnarmed: true
  });
})();
