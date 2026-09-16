import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const bootstrap = fs.readFileSync(path.join(root, "dashboard-bootstrap.js"), "utf8");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");

assert.equal(Boolean(manifest.content_security_policy?.extension_pages), true);
assert.match(manifest.content_security_policy.extension_pages, /script-src 'self'/);
assert.match(manifest.content_security_policy.extension_pages, /object-src 'none'/);
assert.match(manifest.content_security_policy.extension_pages, /base-uri 'self'/);
assert.match(manifest.content_security_policy.extension_pages, /frame-ancestors 'none'/);
assert.ok(manifest.host_permissions.includes("https://oauth2.googleapis.com/*"));
assert.equal(manifest.host_permissions.includes("https://*.microsoft.com/*"), false);
assert.equal(manifest.host_permissions.includes("https://*.x.ai/*"), false);
assert.equal(manifest.host_permissions.includes("https://x.ai/*"), false);
assert.equal(manifest.host_permissions.includes("https://api.x.ai/*"), false);
assert.match(bootstrap, /"focus"/);
assert.match(background, /ALLOWED_CLOUD_LAYOUTS/);
assert.equal(fs.existsSync(path.join(root, "dashboard-focus.css")), true);

console.log("v1.16.5 P0 source-security (branch-partial) checks passed.");
