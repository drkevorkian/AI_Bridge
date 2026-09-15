import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hardening = fs.readFileSync(path.join(root, "completion-runtime-hardening.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} missing`);
  const sigEnd = src.indexOf(")", start);
  let depth = 0;
  let i = src.indexOf("{", sigEnd);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`${name} unclosed`);
}

assert.match(
  wrapper,
  /importScripts\("background\.js",\s*"completion-runtime-hardening\.js",\s*"oauth-runtime-hardening\.js",\s*"power\.js"\)/
);
assert.match(hardening, /const STALE_BASELINE_WINDOW_MS = 1200/);
assert.match(hardening, /state\?\.lastResponseBySide/);
assert.match(hardening, /state\?\.generationIdBySide/);
assert.match(hardening, /baseHandleCompletedResponse/);
assert.match(hardening, /staleBaseline: true/);
assert.doesNotMatch(hardening, /innerHTML|eval\s*\(|new Function/);

const sandbox = { Math, Number, String, STALE_BASELINE_WINDOW_MS: 1200 };
vm.runInNewContext(
  `${extractFunction(hardening, "aiBridgeLooksLikeStaleBaseline")}\nthis.check = aiBridgeLooksLikeStaleBaseline;`,
  sandbox
);

const check = sandbox.check;
assert.equal(check({ previousText: "old answer", incomingText: "old answer", startedAt: 10_000, completedAt: 10_050 }), true);
assert.equal(check({ previousText: "old answer", incomingText: "old answer", startedAt: 10_000, completedAt: 9_100 }), true);
assert.equal(check({ previousText: "old answer", incomingText: "old answer", startedAt: 10_000, completedAt: 11_199 }), true);
assert.equal(check({ previousText: "old answer", incomingText: "old answer", startedAt: 10_000, completedAt: 11_201 }), false);
assert.equal(check({ previousText: "old answer", incomingText: "new answer", startedAt: 10_000, completedAt: 10_050 }), false);
assert.equal(check({ previousText: "", incomingText: "", startedAt: 10_000, completedAt: 10_050 }), false);
assert.equal(check({ previousText: "same", incomingText: "same", startedAt: 0, completedAt: 10_050 }), false);
assert.equal(check({ previousText: "same", incomingText: "same", startedAt: 10_000, completedAt: NaN }), false);

console.log("v1.16.3 stale-completion baseline regression ok");
