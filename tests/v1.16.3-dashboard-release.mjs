import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "dashboard-release.js"), "utf8");

assert.doesNotMatch(source, /innerHTML|eval\s*\(|new Function/);
assert.match(source, /SETUP_NOTICE_POLL_LIMIT_MS = 3000/);
assert.match(source, /SETUP_NOTICE_POLL_MS = 50/);

let now = 10_000;
const timers = [];
let linkClick = null;
let errorRemoved = false;

const elements = {
  versionBadge: { textContent: "v-old" },
  installedVersionPill: { textContent: "v-old" },
  googleClientId: { value: "" },
  cloudNotice: {
    textContent: "",
    classList: {
      remove(name) {
        if (name === "error") errorRemoved = true;
      }
    }
  },
  cloudConnect: {
    addEventListener(type, fn) {
      if (type === "click") linkClick = fn;
    }
  }
};

class FakeDate extends Date {
  static now() { return now; }
}

const sandbox = {
  String,
  Date: FakeDate,
  document: {
    getElementById(id) { return elements[id] || null; }
  },
  chrome: {
    runtime: {
      getManifest() { return { version: "1.16.3" }; }
    }
  },
  setTimeout(fn, delay) {
    timers.push({ fn, delay });
    return timers.length;
  }
};

vm.runInNewContext(source, sandbox);
assert.equal(elements.versionBadge.textContent, "v1.16.3");
assert.equal(elements.installedVersionPill.textContent, "v1.16.3");
assert.equal(typeof linkClick, "function");

// Click starts a bounded poll. The first callback intentionally happens before
// dashboard.js has received the async setupRequired response.
linkClick();
assert.equal(timers.length, 1);
let timer = timers.shift();
assert.equal(timer.delay, 0);
timer.fn();
assert.equal(elements.cloudNotice.textContent, "");
assert.equal(timers.length, 1, "helper should retry while the async response is pending");
assert.equal(timers[0].delay, 50);

// The background response arrives after that first poll and dashboard.js writes
// its legacy generic notice. The next bounded poll must refine it.
elements.cloudNotice.textContent = "Google login is not configured yet.";
now += 50;
timer = timers.shift();
timer.fn();
assert.match(elements.cloudNotice.textContent, /Google Drive login is optional/);
assert.match(elements.cloudNotice.textContent, /Web OAuth client/);
assert.match(elements.cloudNotice.textContent, /Chrome Sync Push\/Pull works without Google Drive/);
assert.equal(errorRemoved, true);
assert.equal(timers.length, 0, "polling must stop immediately once the notice is refined");

console.log("v1.16.3 dashboard release/setup notice regression ok");
