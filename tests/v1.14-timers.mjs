import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const generationHardening = fs.readFileSync(path.join(root, "coordinator-generation-hardening.js"), "utf8");
const html = fs.readFileSync(path.join(root, "dashboard.html"), "utf8");
const rosterPrelude = fs.readFileSync(path.join(root, "dashboard-roster-prelude.js"), "utf8");
const dashboardJs = fs.readFileSync(path.join(root, "dashboard.js"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

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

assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.ok(manifest.permissions.includes("alarms"));
assert.match(html, /id="maxCycles"/);
assert.match(html, /id="checkpointEveryNCycles"/);
assert.match(html, /id="stuckTimeoutMinutes"/);
assert.match(html, /id="agentRosterHost"/);
assert.match(rosterPrelude, /"timerTotal" \+ side/);
assert.match(rosterPrelude, /"timerCurrent" \+ side/);
assert.match(rosterPrelude, /Total working time for this LLM in the current session/);
assert.match(rosterPrelude, /Current turn timer for this LLM/);
assert.match(dashboardJs, /timerTotal\$\{side\}/);
assert.match(content, /AI_BRIDGE_GENERATION_STATUS/);
assert.match(content, /AI_BRIDGE_STOP_GENERATION/);
assert.match(content, /generationId: currentGenerationId/);
assert.match(background, /WATCHDOG_ALARM = "ai-bridge-watchdog"/);
assert.match(background, /periodInMinutes: 1/);
assert.match(background, /Automatic recovery attempt 1/);
assert.match(background, /recoveryCheckpoint/);

const sandbox = {
  SIDES: ["A", "B", "C"],
  INFINITE_TURNS: -1,
  DEFAULT_CHECKPOINT_EVERY: 5,
  DEFAULT_STUCK_MINUTES: 30,
  Date,
  Math,
  Number,
  String,
  Boolean,
  Array,
  Object,
  Set,
  JSON
};
vm.runInNewContext(
  [
    extractFunction(background, "normalizeActiveSides"),
    extractFunction(background, "clampCheckpointEvery"),
    extractFunction(background, "clampStuckTimeoutMinutes"),
    extractFunction(background, "checkpointDue"),
    extractFunction(background, "recordSequentialParticipation"),
    extractFunction(background, "shouldDeclareStuck"),
    extractFunction(background, "nextRecoveryAttemptAllowed"),
    extractFunction(background, "accumulateTotalWorkMs"),
    "this.normalizeActiveSides = normalizeActiveSides;",
    "this.clampCheckpointEvery = clampCheckpointEvery;",
    "this.clampStuckTimeoutMinutes = clampStuckTimeoutMinutes;",
    "this.checkpointDue = checkpointDue;",
    "this.recordSequentialParticipation = recordSequentialParticipation;",
    "this.shouldDeclareStuck = shouldDeclareStuck;",
    "this.nextRecoveryAttemptAllowed = nextRecoveryAttemptAllowed;",
    "this.accumulateTotalWorkMs = accumulateTotalWorkMs;"
  ].join("\n"),
  sandbox
);

assert.equal(sandbox.clampCheckpointEvery("nope"), 5);
assert.equal(sandbox.clampCheckpointEvery(0), 1);
assert.equal(sandbox.clampCheckpointEvery(50), 50);
assert.equal(sandbox.clampStuckTimeoutMinutes("nope"), 30);
assert.equal(sandbox.clampStuckTimeoutMinutes(4), 5);
assert.equal(sandbox.clampStuckTimeoutMinutes(121), 120);
assert.equal(sandbox.checkpointDue(0, 5), false);
assert.equal(sandbox.checkpointDue(1, 5), true);
assert.equal(sandbox.checkpointDue(6, 5), true);
assert.equal(sandbox.nextRecoveryAttemptAllowed(0), true);
assert.equal(sandbox.nextRecoveryAttemptAllowed(1), false);
assert.equal(sandbox.accumulateTotalWorkMs(12000, 5000), 17000);

const now = Date.now();
assert.equal(sandbox.shouldDeclareStuck({ startedAt: 0, lastProgressAt: now, now, timeoutMs: 30 * 60 * 1000 }), false);
assert.equal(sandbox.shouldDeclareStuck({
  startedAt: now - 40 * 60 * 1000,
  lastProgressAt: now - 31 * 60 * 1000,
  now,
  timeoutMs: 30 * 60 * 1000
}), true);

let participants = [];
let completed = 0;
for (const side of ["A", "B", "C", "A", "B", "C"]) {
  const result = sandbox.recordSequentialParticipation(participants, side, ["A", "B", "C"]);
  participants = result.participants;
  if (result.cycleCompleted) completed += 1;
}
assert.equal(completed, 2);
assert.deepEqual([...participants], []);

// Production generation matching is intentionally supplied by the post-core
// hardening layer. Empty expected IDs must fail closed so leftover DOM output
// during START/RESUME cannot advance a session.
const generationSandbox = {
  globalThis: null,
  String,
  Boolean,
  __AI_BRIDGE_EXECUTION_KEY_ADAPTER_V1__: {
    version: 1,
    read() { return undefined; },
    write(_state, _mapName, _agentRef, value) { return value; }
  }
};
generationSandbox.globalThis = generationSandbox;
vm.createContext(generationSandbox);
vm.runInContext('function generationMatches(expectedId, incomingId) { const expected = String(expectedId || ""); if (!expected) return true; return String(incomingId || "") === expected; }', generationSandbox);
vm.runInContext(generationHardening, generationSandbox, { filename: "coordinator-generation-hardening.js" });
assert.equal(generationSandbox.generationMatches("", "anything"), false);
assert.equal(generationSandbox.generationMatches(null, "x"), false);
assert.equal(generationSandbox.generationMatches("abc", "abc"), true);
assert.equal(generationSandbox.generationMatches("abc", "xyz"), false);
assert.equal(generationSandbox.generationMatches("abc", ""), false);

console.log("v1.14 timer/cycle + fail-closed generation regression ok");
