import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

const manifest = JSON.parse(read("manifest.json"));
assert.equal(manifest.version, "1.17.1");
assert.ok(Number(manifest.minimum_chrome_version) >= 106);
assert.equal(
  manifest.content_security_policy?.extension_pages,
  "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
);
assert.equal(manifest.host_permissions.includes("https://x.ai/*"), false);
assert.equal(manifest.host_permissions.includes("https://api.x.ai/*"), false);
assert.ok(manifest.content_scripts?.[0]?.js?.includes("content-artifact-security-prelude.js"));

const mutex = read("coordinator-mutex-prelude.js");
assert.match(mutex, /AI_BRIDGE_SET_TEAM_RULES/);
assert.match(mutex, /hardenedTabRemovedAddListener/);
assert.match(mutex, /enqueueCoordinatorMutation\(\(\) => listener\(tabId, removeInfo\)\)/);

const manualRelay = read("manual-relay-runtime-hardening.js");
assert.match(manualRelay, /result\.generating/);
assert.match(manualRelay, /still generating/i);

const oauth = read("oauth-runtime-hardening.js");
assert.match(oauth, /googleImplicitFlowDisabled:\s*true/);
assert.match(oauth, /disabledLegacyGoogleWebAuth/);
assert.match(oauth, /googleOauthPackaged\(\)/);
assert.doesNotMatch(oauth, /baseLaunchGoogleWebAuth\(options\)/, "legacy implicit flow must not remain callable through hardening");

const dashboardBootstrap = read("dashboard-bootstrap.js");
assert.match(dashboardBootstrap, /PROVIDER_TAB_PATTERNS/);
assert.match(dashboardBootstrap, /nativeTabsQuery\(\{ url: \[\.\.\.PROVIDER_TAB_PATTERNS\] \}\)/);
assert.match(dashboardBootstrap, /legacyWebOauthDisabled:\s*true/);

const focusRelease = read("dashboard-release.js");
const focusCss = read("dashboard-focus.css");
const focusRuntime = read("focus-runtime-hardening.js");
assert.match(focusRelease, /LAYOUTS\.add\("focus"\)/);
assert.match(focusRelease, /layoutFocusBtn/);
assert.match(focusRelease, /role", "tab"/);
assert.match(focusRelease, /preservesExistingControlIds:\s*true/);
assert.match(focusCss, /html\[data-layout="focus"\]/);
assert.match(focusCss, /min-height:\s*44px/);
assert.match(focusRuntime, /ALLOWED_CLOUD_LAYOUTS\.add\("focus"\)/);

const contentArtifactSource = read("content-artifact-security-prelude.js");
const calls = [];
const context = vm.createContext({
  URL,
  window: null,
  location: {
    hostname: "chatgpt.com",
    origin: "https://chatgpt.com",
    href: "https://chatgpt.com/c/abc123",
    pathname: "/c/abc123"
  },
  fetch: async (input, init) => {
    calls.push({ input: String(input), init });
    return { ok: true };
  }
});
context.window = context;
vm.runInContext(contentArtifactSource, context, { filename: "content-artifact-security-prelude.js" });

await context.fetch(
  "https://chatgpt.com/backend-api/conversation/abc123/interpreter/download?message_id=m1&sandbox_path=%2Fmnt%2Fdata%2Fresult.zip",
  { credentials: "include" }
);
assert.equal(calls.at(-1).init.credentials, "include", "current-conversation interpreter artifact may use provider auth");

await context.fetch("https://chatgpt.com/backend-api/private/account", { credentials: "include" });
assert.equal(calls.at(-1).init.credentials, "omit", "arbitrary same-origin URL must not inherit cookies");

await context.fetch("https://files.oaiusercontent.com/signed.bin", { credentials: "include" });
assert.equal(calls.at(-1).init.credentials, "omit", "signed/CDN artifact fetches must stay credentialless");

console.log("v1.17 security/UI regression checks passed.");
