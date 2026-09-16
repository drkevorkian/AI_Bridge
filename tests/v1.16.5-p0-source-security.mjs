import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const dashboardJs = fs.readFileSync(path.join(root, "dashboard.js"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

assert.match(background, /credentials:\s*"omit"/);
assert.match(background, /referrerPolicy:\s*"no-referrer"/);
const allowFn = background.slice(
  background.indexOf("function artifactFetchHostAllowed"),
  background.indexOf("async function fetchArtifactInBackground")
);
assert.match(allowFn, /copilot\.microsoft\.com/);
assert.doesNotMatch(allowFn, /endsWith\("\.microsoft\.com"\)/);
assert.doesNotMatch(allowFn, /www\.microsoft\.com/);
assert.match(background, /AI_BRIDGE_OBSERVE_ARTIFACT_URLS/);
assert.match(background, /Artifact URL was not observed on the bound provider tab/);
assert.match(background, /response_type:\s*"code"/);
assert.match(background, /code_challenge_method:\s*"S256"/);
assert.doesNotMatch(background, /response_type:\s*"token"/);
assert.match(background, /Implicit OAuth tokens are no longer accepted/);
assert.match(background, /oauth2\.googleapis\.com/);

assert.equal(Boolean(manifest.content_security_policy?.extension_pages), true);
assert.match(manifest.content_security_policy.extension_pages, /script-src 'self'/);
assert.match(manifest.content_security_policy.extension_pages, /object-src 'none'/);
assert.ok(manifest.host_permissions.includes("https://oauth2.googleapis.com/*"));
assert.equal(manifest.host_permissions.includes("https://*.microsoft.com/*"), false);
assert.equal(manifest.host_permissions.includes("https://*.x.ai/*"), false);

assert.match(dashboardJs, /chrome\.tabs\.query\(\{\s*url:/);
assert.doesNotMatch(dashboardJs, /chrome\.tabs\.query\(\{\}\)/);
assert.match(dashboardJs, /const LAYOUTS = new Set\(\[["studio", "classic", "focus"\]\)/);
assert.doesNotMatch(dashboardJs, /innerHTML/);
assert.doesNotMatch(dashboardJs, /eval\s*\(|new Function/);

assert.match(content, /AI_BRIDGE_OBSERVE_ARTIFACT_URLS/);
assert.match(content, /if \(\/\^https:\/i\.test\(url\)\)/);
assert.doesNotMatch(content, /if \(\/\^https\?:\/i\.test\(url\)\)/);

function extract(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} missing`);
  let depth = 0;
  let i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`${name} unclosed`);
}

const context = vm.createContext({ URL, Set, Map, Date, Number, String, Boolean, Array, Object, Math });
vm.runInContext(extract(background, "artifactFetchHostAllowed"), context);
assert.equal(context.artifactFetchHostAllowed("https://chatgpt.com/file"), true);
assert.equal(context.artifactFetchHostAllowed("https://login.microsoft.com/file"), false);
assert.equal(context.artifactFetchHostAllowed("https://evil.x.ai/file"), false);
assert.equal(context.artifactFetchHostAllowed("http://chatgpt.com/file"), false);
assert.equal(context.artifactFetchHostAllowed("https://user:pass@chatgpt.com/file"), false);
assert.equal(context.artifactFetchHostAllowed("https://copilot.microsoft.com:8443/file"), false);

console.log("v1.16.5 P0 source-security regression checks passed.");
