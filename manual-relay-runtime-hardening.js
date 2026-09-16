(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_MANUAL_RELAY_HARDENING_V1__";
  if (globalThis[FLAG]) return;

  if (typeof captureLatestFromSide !== "function") {
    throw new Error("AI Bridge manual-relay hardening loaded before coordinator capture support.");
  }

  const baseCaptureLatestFromSide = captureLatestFromSide;

  /**
   * Manual relay is a recovery path for a reply the normal completion monitor
   * missed. It must never turn a still-streaming partial response into a
   * committed coordinator turn. The provider content script already exposes a
   * `generating` bit; fail closed here before forceRelayCapturedResponse can
   * mutate transcript, timers, routing, or artifact state.
   */
  captureLatestFromSide = async function hardenedCaptureLatestFromSide(side) {
    const captured = await baseCaptureLatestFromSide(side);
    if (captured?.generating) {
      throw new Error(`AI ${String(side || "?").toUpperCase()} is still generating. Wait for the reply to finish before using Manual Relay.`);
    }
    return captured;
  };

  globalThis[FLAG] = Object.freeze({
    version: 1,
    rejectsStreamingCapture: true
  });
})();
