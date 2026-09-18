import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const dynamic = fs.readFileSync(path.join(root, "coordinator-dynamic-agents.js"), "utf8");
const viewpoint = fs.readFileSync(path.join(root, "viewpoint-runtime.js"), "utf8");

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

function regionAfter(source, marker, untilMarker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${marker} must exist`);
  const end = untilMarker ? source.indexOf(untilMarker, start + marker.length) : -1;
  return source.slice(start, end >= 0 ? end : source.length);
}

const pauseBody = functionBody(background, "pauseBridge");
assert.match(pauseBody, /state\.running\s*=\s*false/);
assert.match(pauseBody, /state\.paused\s*=\s*true/);
assert.match(pauseBody, /clearWatchdogAlarm\s*\(/);
assert.doesNotMatch(pauseBody, /generationIdBySide/);
assert.doesNotMatch(pauseBody, /viewpointIdentityBySide/);
assert.doesNotMatch(pauseBody, /STOP_GENERATION|stopActiveGeneration/);

const resumeRegion = regionAfter(background, 'if (msg.type === "AI_BRIDGE_RESUME")', 'if (msg.type === "AI_BRIDGE_RESEND")');
assert.match(resumeRegion, /state\.running\s*=\s*true/);
assert.match(resumeRegion, /state\.paused\s*=\s*false/);
assert.doesNotMatch(resumeRegion, /generationIdBySide\s*=\s*\{/);
assert.doesNotMatch(resumeRegion, /viewpointIdentityBySide\s*=\s*\{/);

const recoveryBody = functionBody(background, "recoverStuckSide");
assert.match(recoveryBody, /SIDES\.includes\(side\)/);
assert.match(recoveryBody, /tabForSide\(side\)/);
assert.match(recoveryBody, /recoveryAttemptBySide\[side\]/);
assert.match(recoveryBody, /sourceDeliveredBySide\[side\]\s*=\s*false/);
assert.match(recoveryBody, /delete\s+state\.lastResponseBySide\[side\]/);
assert.match(recoveryBody, /resetChatTab\(tabForSide\(side\)\)/);
assert.doesNotMatch(recoveryBody, /generationIdBySide\s*=\s*\{\s*A:\s*null\s*,\s*B:\s*null\s*,\s*C:\s*null\s*\}\s*;/);

assert.match(dynamic, /SIDES\.splice\(0,\s*SIDES\.length,\s*\.\.\.next\)/);
assert.match(dynamic, /next\.generationIdBySide\s*=\s*expandMap\(next\.generationIdBySide,\s*null\)/);
assert.match(dynamic, /next\.recoveryAttemptBySide\s*=\s*expandMap\(next\.recoveryAttemptBySide,\s*0\)/);

assert.match(
  viewpoint,
  /executionKeys\.write\(state,\s*"viewpointIdentityBySide",\s*side,\s*safe\)/,
  "viewpoint identity publication must use the canonical execution-key adapter"
);
assert.match(
  viewpoint,
  /executionKeys\.remove\(state,\s*"viewpointIdentityBySide",\s*side\)/,
  "failed dispatch cleanup must remove only the selected agent identity through the adapter"
);
assert.match(
  viewpoint,
  /executionKeys\.write\(state,\s*"generationIdBySide",\s*side,\s*null\)/,
  "failed dispatch cleanup must disarm only the selected agent generation through the adapter"
);
assert.doesNotMatch(viewpoint, /\[side\]:\s*safe/);
assert.doesNotMatch(viewpoint, /delete\s+next\[side\]/);

console.log("viewpoint-lifecycle-isolation: ok");
