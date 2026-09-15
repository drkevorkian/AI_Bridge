(() => {
  if (window.__AI_BRIDGE_LOADED_V114__) return;
  window.__AI_BRIDGE_LOADED_V114__ = true;

  const host = location.hostname;
  let lastObservedText = "";
  let lastChangeAt = 0;
  let lastReportedText = "";
  let lastReportedSignature = "";
  let pendingSend = false;
  let currentGenerationId = "";
  const inFlightDeliveries = new Set();
  const MAX_ARTIFACTS_PER_RESPONSE = 8;
  const MAX_ARTIFACT_FILE_BYTES = 12 * 1024 * 1024;
  const MAX_ARTIFACT_TOTAL_BYTES = 24 * 1024 * 1024;
  const ARTIFACT_FETCH_TIMEOUT_MS = 15000;
  const DOWNLOAD_CANDIDATE_SELECTOR = [
    "a[href]", "a[download]", "button", "[role='button']",
    "[data-download-url]", "[data-file-url]", "[data-url]", "[data-href]"
  ].join(",");
