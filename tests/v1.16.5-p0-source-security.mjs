import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const bootstrap = fs.readFileSync(path.join(root, "dashboard-bootstrap.js"), "utf8");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");
const oauthHardening = fs.readFileSync(path.join(root, "oauth-runtime-hardening.js"), "utf8");
const artifactHardening = fs.readFileSync(path.join(root, "artifact-fetch-runtime-hardening.js"), "utf8");

assert.equal(Boolean(manifest.content_security_policy?.extension_pages), true);
assert.match(manifest.content_security_policy.extension_pages, /script-src 'self'/);
assert.match(manifest.content_security_policy.extension_pages, /object-src 'none'/);
assert.match(manifest.content_security_policy.extension_pages, /base-uri 'none'/);
assert.match(manifest.content_security_policy.extension_pages, /frame-ancestors 'none'/);

// The undocumented Web-client Google token exchange path is intentionally not
// granted. Packaged builds use chrome.identity.getAuthToken + manifest.oauth2.
assert.equal(manifest.host_permissions.includes("https://oauth2.googleapis.com/*"), false);
assert.equal(manifest.host_permissions.includes("https://*.microsoft.com/*"), false);
assert.equal(manifest.host_permissions.includes("https://*.x.ai/*"), false);
assert.equal(manifest.host_permissions.includes("https://x.ai/*"), false);
assert.equal(manifest.host_permissions.includes("https://api.x.ai/*"), false);
assert.match(oauthHardening, /googleImplicitFlowDisabled:\s*true/);
assert.match(oauthHardening, /packagedGoogleAuthUsesChromeIdentity:\s*true/);

// `background.js` retains a compatibility-era helper, but it is never exposed
// as the live privileged primitive: a worker-wide credential guard loads before
// background.js and the dedicated artifact implementation replaces the helper
// synchronously before extension events are dispatched.
assert.match(wrapper, /worker-fetch-security-prelude\.js/);
assert.ok(
  wrapper.indexOf('importScripts("worker-fetch-security-prelude.js")') < wrapper.indexOf('importScripts("background.js")'),
  "worker credential guard must load before background.js"
);
assert.ok(
  wrapper.indexOf('importScripts("background.js")') < wrapper.indexOf('importScripts("artifact-fetch-runtime-hardening.js")'),
  "artifact implementation must replace the compatibility helper immediately after background.js"
);
assert.match(artifactHardening, /credentials:\s*"omit"/);
assert.match(artifactHardening, /streamedSizeLimit:\s*true/);
assert.match(background, /ALLOWED_CLOUD_LAYOUTS/);

assert.match(bootstrap, /"focus"/);
assert.equal(fs.existsSync(path.join(root, "dashboard-focus.css")), true);

console.log("v1.17 P0 security architecture checks passed.");
