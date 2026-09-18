import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const semantics = fs.readFileSync(path.join(root, "coordinator-dynamic-semantics.js"), "utf8");

function functionBody(source, name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist`);
  const brace = source.indexOf("{", start);
  assert.notEqual(brace, -1, `${name} must have a body`);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(brace + 1, i);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

const rosterBody = functionBody(background, "rosterAgentForSide");
const writeRosterBody = functionBody(background, "writeRosterAgentForSide");
const tabBody = functionBody(background, "tabForSide");
const labelBody = functionBody(background, "labelForSide");
const jobBody = functionBody(background, "jobForSide");

assert.match(
  rosterBody,
  /__AI_BRIDGE_ROSTER_STATE_ADAPTER_V1__/,
  "central background roster accessor must consult the roster adapter"
);
assert.match(
  rosterBody,
  /roster\.readAgent\(state, side\)/,
  "central background roster accessor must delegate to adapter readAgent after bootstrap"
);
assert.match(
  rosterBody,
  /state\[`tab\$\{side\}`\]/,
  "bootstrap compatibility fallback must retain legacy tab reads before adapter load"
);
assert.match(
  writeRosterBody,
  /roster\.writeAgent\(state, normalizedSide, patch\)/,
  "central background roster mutation helper must delegate to adapter writeAgent after bootstrap"
);
assert.match(
  writeRosterBody,
  /\^\[A-E\]\$/,
  "pre-adapter mutation fallback must fail closed to the v1.17.1 logical-side set"
);
assert.match(tabBody, /rosterAgentForSide\(side\)\.tabId/);
assert.match(labelBody, /rosterAgentForSide\(side\)\.label/);
assert.match(jobBody, /rosterAgentForSide\(side\)\.job/);
assert.doesNotMatch(tabBody, /state\[`tab\$\{side\}`\]/);
assert.doesNotMatch(labelBody, /state\[`label\$\{side\}`\]/);
assert.doesNotMatch(jobBody, /state\[`job\$\{side\}`\]/);

const savedBindingBody = functionBody(background, "validateSavedBindings");
assert.match(savedBindingBody, /writeRosterAgentForSide\(side, \{ tabId: null \}\)/);
assert.doesNotMatch(savedBindingBody, /state\[`tab\$\{side\}`\]\s*=/);

assert.match(
  semantics,
  /rosterState\.writeAgent\(state, side, \{[\s\S]*?job:/,
  "idle cloud job writes must route through the roster adapter"
);
assert.doesNotMatch(
  functionBody(semantics, "dynamicApplyIdleCloudSettings"),
  /state\[`job\$\{side\}`\]\s*=/,
  "dynamic cloud settings must not write job storage directly"
);

console.log("central-roster-accessors: ok");
