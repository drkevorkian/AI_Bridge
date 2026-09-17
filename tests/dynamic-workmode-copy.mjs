import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const copy = read("dashboard-dynamic-workmode-copy.js");
const bootstrap = read("dashboard-bootstrap.js");

assert.match(bootstrap, /dashboard-dynamic-workmode-copy\.js/,
  "bootstrap should load the dynamic work-mode copy adapter");
assert.match(bootstrap, /dynamicWorkModeCopyAdapter:\s*true/,
  "bootstrap diagnostics should report the copy adapter");

assert.match(copy, /\["A", "B", "C", "D", "E"\]/,
  "work-mode copy should support the full dynamic roster");
assert.match(copy, /data-agent-count/,
  "copy should refresh when the live roster count changes");
assert.match(copy, /MutationObserver/,
  "copy should react to roster changes restored without a select change event");
assert.match(copy, /SEND TO:\s*\$\{aiList\(sides\)\}/,
  "Mesh instructions should be generated from the live roster");
assert.match(copy, /sides\.join\(" → "\)/,
  "sequential mode timing should be generated from the live roster");
assert.match(copy, /all \$\{count\} selected AIs/,
  "batch-mode copy should use the selected roster size rather than hard-coded three-agent wording");
assert.doesNotMatch(copy, /Timing: A, B, and C start simultaneously/i,
  "generated batch help must not reintroduce fixed A/B/C timing copy");
assert.doesNotMatch(copy, /all three still start together/i,
  "generated batch help must not reintroduce fixed three-agent participation copy");
assert.doesNotMatch(copy, /AI A\|B\|C(?!\|D)/,
  "Mesh targets must not stop at the legacy A-C roster");
assert.match(copy, /help\.textContent\s*=/,
  "work-mode help should render as text only");
assert.doesNotMatch(copy, /innerHTML|insertAdjacentHTML/,
  "dynamic help must not introduce HTML injection surfaces");
assert.match(copy, /rewriteLegacyStatusCopy/,
  "copy adapter should normalize legacy Start/Resume status text");
assert.match(copy, /Starting \$\{count\}-AI session/,
  "Start status should report the live roster size");
assert.match(copy, /all \$\{count\} selected roles/,
  "Resume guidance should report the live roster size");
assert.match(copy, /Every later turn from \$\{recipients\}/,
  "team-rules success copy should report the live roster rather than A/B/C");
assert.match(copy, /dynamicTeamRulesStatusCopy:\s*true/,
  "diagnostics should expose dynamic team-rules status copy");
assert.match(copy, /statusObserver\.observe\(status/,
  "copy adapter should react when legacy handlers update session status");
assert.match(copy, /dynamicSessionStatusCopy:\s*true/,
  "diagnostics should expose dynamic Start/Resume status copy");
assert.match(copy, /__AI_BRIDGE_DYNAMIC_WORKMODE_COPY__/,
  "adapter should expose a diagnostic marker");
assert.match(copy, /textOnlyRendering:\s*true/,
  "diagnostics should lock the text-only rendering guarantee");

console.log("dynamic-workmode-copy: ok");
