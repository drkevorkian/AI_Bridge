(() => {
  "use strict";

  const FLAG = "__AI_BRIDGE_UPDATE_HARDENING_V1__";
  if (globalThis[FLAG]) return;
  globalThis[FLAG] = true;

  if (typeof compareVersions !== "function") {
    throw new Error("AI Bridge update hardening loaded before version comparison support.");
  }

  const OWNER = "drkevorkian";
  const REPO = "AI_Bridge";
  const PIN_KEY = "aiBridgePinnedUpdate";
  const PIN_TTL_MS = 6 * 60 * 60 * 1000;
  const SHA_RE = /^[a-f0-9]{40}$/i;

  function sanitizeVersion(raw) {
    const value = String(raw || "").trim();
    if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(value)) throw new Error("Remote manifest version rejected.");
    return value;
  }

  function pinnedManifestUrl(sha) {
    return `https://raw.githubusercontent.com/${OWNER}/${REPO}/${sha}/manifest.json`;
  }

  function pinnedZipUrl(sha) {
    return `https://codeload.github.com/${OWNER}/${REPO}/zip/${sha}`;
  }

  async function secureGithubFetch(url) {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) {
      throw new Error("Update URL rejected.");
    }
    const allowed = parsed.hostname === "api.github.com"
      || parsed.hostname === "raw.githubusercontent.com"
      || parsed.hostname === "codeload.github.com";
    if (!allowed) throw new Error("Update host rejected.");

    const response = await fetch(parsed.href, {
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer"
    });
    if (!response.ok) throw new Error(`Update request failed (HTTP ${response.status}).`);
    return response;
  }

  async function resolveMainCommitSha() {
    const response = await secureGithubFetch(`https://api.github.com/repos/${OWNER}/${REPO}/commits/main`);
    const text = await response.text();
    if (text.length > 200000) throw new Error("GitHub commit response is too large.");
    let payload;
    try { payload = JSON.parse(text); } catch (_) { throw new Error("GitHub commit response is invalid JSON."); }
    const sha = String(payload?.sha || "");
    if (!SHA_RE.test(sha)) throw new Error("GitHub did not return a valid immutable commit SHA.");
    return sha.toLowerCase();
  }

  async function readPinnedManifest(sha) {
    if (!SHA_RE.test(sha)) throw new Error("Pinned update SHA rejected.");
    const response = await secureGithubFetch(pinnedManifestUrl(sha));
    const text = await response.text();
    if (text.length > 20000) throw new Error("Remote manifest is too large.");
    let remote;
    try { remote = JSON.parse(text); } catch (_) { throw new Error("Remote manifest is not valid JSON."); }
    return { remote, source: pinnedManifestUrl(sha) };
  }

  async function writePin(info) {
    if (!chrome.storage?.session?.set) return;
    await chrome.storage.session.set({
      [PIN_KEY]: {
        commitSha: info.commitSha,
        remoteVersion: info.remoteVersion,
        zipUrl: info.zipUrl,
        source: info.source,
        checkedAt: Date.now()
      }
    });
  }

  async function readPin() {
    try {
      const pack = await chrome.storage?.session?.get?.(PIN_KEY);
      const pin = pack?.[PIN_KEY];
      if (!pin || typeof pin !== "object") return null;
      if (!SHA_RE.test(String(pin.commitSha || ""))) return null;
      if (Date.now() - Number(pin.checkedAt || 0) > PIN_TTL_MS) return null;
      const remoteVersion = sanitizeVersion(pin.remoteVersion);
      const expectedZip = pinnedZipUrl(pin.commitSha);
      const expectedSource = pinnedManifestUrl(pin.commitSha);
      if (pin.zipUrl !== expectedZip || pin.source !== expectedSource) return null;
      return { ...pin, remoteVersion };
    } catch (_) {
      return null;
    }
  }

  checkForExtensionUpdate = async function pinnedCheckForExtensionUpdate() {
    const installedVersion = sanitizeVersion(chrome.runtime.getManifest()?.version || "0.0.0");
    const commitSha = await resolveMainCommitSha();
    const { remote, source } = await readPinnedManifest(commitSha);
    const remoteVersion = sanitizeVersion(remote?.version || "");
    const cmp = compareVersions(remoteVersion, installedVersion);
    const info = {
      ok: true,
      installedVersion,
      remoteVersion,
      updateAvailable: cmp > 0,
      commitSha,
      zipUrl: pinnedZipUrl(commitSha),
      source,
      immutablePin: true
    };
    await writePin(info);
    return info;
  };

  downloadExtensionUpdate = async function pinnedDownloadExtensionUpdate() {
    const installedVersion = sanitizeVersion(chrome.runtime.getManifest()?.version || "0.0.0");
    let pin = await readPin();
    if (!pin) {
      const fresh = await checkForExtensionUpdate();
      pin = {
        commitSha: fresh.commitSha,
        remoteVersion: fresh.remoteVersion,
        zipUrl: fresh.zipUrl,
        source: fresh.source,
        checkedAt: Date.now()
      };
    }

    // Re-read the manifest from the exact same SHA immediately before download.
    // A force-pushed main branch cannot alter what this user downloads.
    const { remote } = await readPinnedManifest(pin.commitSha);
    const remoteVersion = sanitizeVersion(remote?.version || "");
    if (remoteVersion !== pin.remoteVersion) throw new Error("Pinned update manifest changed unexpectedly.");
    const updateAvailable = compareVersions(remoteVersion, installedVersion) > 0;
    const filename = `AI_Bridge_v${remoteVersion}_${pin.commitSha.slice(0, 12)}.zip`;
    const downloadId = await chrome.downloads.download({
      url: pinnedZipUrl(pin.commitSha),
      filename,
      saveAs: true
    });
    return {
      ok: true,
      downloadId,
      filename,
      installedVersion,
      remoteVersion,
      updateAvailable,
      commitSha: pin.commitSha,
      zipUrl: pinnedZipUrl(pin.commitSha),
      source: pinnedManifestUrl(pin.commitSha),
      immutablePin: true
    };
  };

  globalThis[FLAG] = Object.freeze({
    version: 1,
    immutableCommitPin: true,
    credentials: "omit",
    pinStorage: "session"
  });
})();