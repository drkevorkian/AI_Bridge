import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "update-runtime-hardening.js"), "utf8");

const sha = "0123456789abcdef0123456789abcdef01234567";
const calls = [];
const downloads = [];
let session = {};

function response({ url, status = 200, body }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    async text() { return typeof body === "string" ? body : JSON.stringify(body); }
  };
}

const sandbox = {
  console,
  URL,
  Date,
  JSON,
  String,
  Number,
  RegExp,
  Promise,
  globalThis: null,
  compareVersions(left, right) {
    const a = String(left).split(".").map(Number);
    const b = String(right).split(".").map(Number);
    for (let i = 0; i < 3; i += 1) {
      if ((a[i] || 0) > (b[i] || 0)) return 1;
      if ((a[i] || 0) < (b[i] || 0)) return -1;
    }
    return 0;
  },
  fetch: async (url, options) => {
    calls.push({ url: String(url), options: { ...options } });
    if (String(url).endsWith("/commits/main")) {
      return response({ url: String(url), body: { sha } });
    }
    if (String(url) === `https://raw.githubusercontent.com/drkevorkian/AI_Bridge/${sha}/manifest.json`) {
      return response({ url: String(url), body: { version: "1.17.1" } });
    }
    throw new Error(`unexpected fetch ${url}`);
  },
  chrome: {
    runtime: { getManifest() { return { version: "1.17.0" }; } },
    storage: {
      session: {
        async set(pack) { session = { ...session, ...pack }; },
        async get(key) { return { [key]: session[key] }; }
      }
    },
    downloads: {
      async download(options) {
        downloads.push(options);
        return 77;
      }
    }
  },
  checkForExtensionUpdate: async () => ({ legacy: true }),
  downloadExtensionUpdate: async () => ({ legacy: true })
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "update-runtime-hardening.js" });

assert.equal(sandbox.__AI_BRIDGE_UPDATE_HARDENING_V1__.immutableCommitPin, true);

const info = await sandbox.checkForExtensionUpdate();
assert.equal(info.updateAvailable, true);
assert.equal(info.commitSha, sha);
assert.equal(info.immutablePin, true);
assert.equal(info.source, `https://raw.githubusercontent.com/drkevorkian/AI_Bridge/${sha}/manifest.json`);
assert.equal(info.zipUrl, `https://codeload.github.com/drkevorkian/AI_Bridge/zip/${sha}`);
assert.equal(calls[0].options.credentials, "omit");
assert.equal(calls[0].options.redirect, "error");
assert.equal(calls[1].options.credentials, "omit");
assert.ok(!calls.some(call => call.url.includes("raw.githubusercontent.com/drkevorkian/AI_Bridge/main/manifest.json")));

const downloaded = await sandbox.downloadExtensionUpdate();
assert.equal(downloaded.commitSha, sha);
assert.equal(downloaded.immutablePin, true);
assert.equal(downloads.length, 1);
assert.equal(downloads[0].url, `https://codeload.github.com/drkevorkian/AI_Bridge/zip/${sha}`);
assert.match(downloads[0].filename, /AI_Bridge_v1\.17\.1_0123456789ab\.zip/);
assert.equal(downloads[0].saveAs, true);

console.log("v1.17 immutable updater regression passed.");
