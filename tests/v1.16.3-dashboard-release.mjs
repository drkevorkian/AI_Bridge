import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "dashboard-release.js"), "utf8");

function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} missing`);
  const sigEnd = src.indexOf(")", start);
  let depth = 0;
  let i = src.indexOf("{", sigEnd);
  for (; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`${name} unclosed`);
}

assert.doesNotMatch(source, /innerHTML|eval\s*\(|new Function/);
assert.match(source, /SETUP_NOTICE_POLL_LIMIT_MS = 3000/);
assert.match(source, /SETUP_NOTICE_POLL_MS = 50/);
assert.match(source, /LAYOUTS\.add\("focus"\)/);
assert.match(source, /layoutFocusBtn/);
assert.match(source, /Focus — clean tabbed workspace/);
assert.match(source, /legacy Web-client implicit OAuth flow is disabled/i);
assert.match(source, /Chrome Extension OAuth client declared in manifest\.oauth2/i);
assert.match(source, /Chrome Sync Push\/Pull works without Google Drive/i);

let now = 10_000;
const timers = [];
let errorRemoved = false;
const elements = {
  googleClientId: { value: "" },
  cloudNotice: {
    textContent: "",
    classList: {
      remove(name) {
        if (name === "error") errorRemoved = true;
      }
    }
  }
};

class FakeDate extends Date {
  static now() { return now; }
}

const sandbox = {
  String,
  Date: FakeDate,
  GENERIC_GOOGLE_SETUP_NOTICE: "Google login is not configured yet.",
  GOOGLE_SETUP_NOTICE: "Google Drive login is optional. The legacy Web-client implicit OAuth flow is disabled. Packaged builds must use a Chrome Extension OAuth client declared in manifest.oauth2; Chrome Sync Push/Pull works without Google Drive.",
  SETUP_NOTICE_POLL_MS: 50,
  document: {
    getElementById(id) { return elements[id] || null; }
  },
  setTimeout(fn, delay) {
    timers.push({ fn, delay });
    return timers.length;
  }
};
vm.createContext(sandbox);
vm.runInContext(`${extractFunction(source, "refineGoogleSetupNotice")}\nthis.refineGoogleSetupNotice = refineGoogleSetupNotice;`, sandbox);

// Before the async background result appears, refinement waits with a bounded
// retry rather than writing stale setup guidance.
sandbox.refineGoogleSetupNotice(now + 3000);
assert.equal(elements.cloudNotice.textContent, "");
assert.equal(timers.length, 1);
assert.equal(timers[0].delay, 50);

// Once dashboard.js reports that Google is unconfigured, the release helper
// replaces the generic message with the secure packaged-extension guidance.
elements.cloudNotice.textContent = "Google login is not configured yet.";
now += 50;
const timer = timers.shift();
timer.fn();
assert.match(elements.cloudNotice.textContent, /implicit OAuth flow is disabled/i);
assert.match(elements.cloudNotice.textContent, /Chrome Extension OAuth client/i);
assert.match(elements.cloudNotice.textContent, /Chrome Sync Push\/Pull works without Google Drive/i);
assert.equal(errorRemoved, true);
assert.equal(timers.length, 0);

console.log("v1.17 dashboard release/setup notice regression ok");
