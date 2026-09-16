import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const dashboardJs = fs.readFileSync(path.join(root, "dashboard.js"), "utf8");
const html = fs.readFileSync(path.join(root, "dashboard.html"), "utf8");
const mutex = fs.readFileSync(path.join(root, "coordinator-mutex-prelude.js"), "utf8");

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

assert.match(content, /AI_BRIDGE_CAPTURE_LATEST/);
assert.match(content, /async function captureLatestVisibleReply\(/);
assert.match(background, /AI_BRIDGE_FORCE_RELAY/);
assert.match(background, /requireExtensionPage\(sender, "Manual relay"\)/);
assert.match(background, /async function forceRelayCapturedResponse\(/);
assert.match(background, /function sanitizeForceRelaySides\(/);
assert.match(background, /function manualRelayMessage\(/);
assert.match(background, /MANUAL RELAY FROM AI/);
assert.match(background, /wrapUntrustedPeerData\(fromSide,/);
assert.match(mutex, /AI_BRIDGE_FORCE_RELAY/);
assert.match(html, /id="forceRelayBtn"/);
assert.match(html, /id="forceFromA"/);
assert.match(html, /id="forceToC"/);
assert.match(html, /id="useLastA"/);
assert.match(dashboardJs, /AI_BRIDGE_FORCE_RELAY/);
assert.match(dashboardJs, /selectedForceTargets/);
assert.doesNotMatch(dashboardJs, /innerHTML/);

const sandbox = { SIDES: ["A", "B", "C"] };
vm.runInNewContext(
  [
    extractFunction(background, "sanitizeForceRelaySides"),
    "this.sanitizeForceRelaySides = sanitizeForceRelaySides;"
  ].join("\n"),
  sandbox
);

assert.equal(JSON.stringify(sandbox.sanitizeForceRelaySides(["B", "c", "B", "Z", "a"])), JSON.stringify(["B", "C", "A"]));
assert.equal(JSON.stringify(sandbox.sanitizeForceRelaySides("b")), JSON.stringify(["B"]));
assert.equal(JSON.stringify(sandbox.sanitizeForceRelaySides(["", null, "Q"])), JSON.stringify([]));
assert.equal(JSON.stringify(sandbox.sanitizeForceRelaySides(["A", "B", "C"])), JSON.stringify(["A", "B", "C"]));

console.log("v1.16.4 manual relay regression passed.");
