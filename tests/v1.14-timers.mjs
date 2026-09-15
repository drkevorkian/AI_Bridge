import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const dashboardJs = fs.readFileSync(path.join(root, "dashboard.js"), "utf8");
const html = fs.readFileSync(path.join(root, "dashboard.html"), "utf8");
const css = fs.readFileSync(path.join(root, "dashboard.css"), "utf8");
const popupHtml = fs.readFileSync(path.join(root, "popup.html"), "utf8");
const popupJs = fs.readFileSync(path.join(root, "popup.js"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
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

assert.equal(manifest.version, "1.14.0");
assert.ok(manifest.permissions.includes("alarms"));
assert.match(html, /v1\.14\.0/);
assert.match(popupHtml, /v1\.14\.0/);
assert.match(html, /id="maxCycles"/);
assert.match(html, /id="checkpointEveryNCycles"/);
assert.match(html, /id="stuckTimeoutMinutes"/);
assert.match(html, /id="timerTotalA"/);
assert.match(html, /id="timerCurrentA"/);
assert.match(html, /id="timerTotalB"/);
assert.match(html, /id="timerCurrentB"/);
assert.match(html, /id="timerTotalC"/);
assert.match(html, /id="timerCurrentC"/);
assert.doesNotMatch(html, /id="timerA"/);
assert.doesNotMatch(html, /id="maxTurns"/);
assert.match(css, /\.agent-timers/);
assert.match(dashboardJs, /timerTotal\$\{side\}/);
assert.match(dashboardJs, /Cycle \$\{cycles\}/);
assert.match(popupJs, /cycle \$\{cycles\}/);
assert.match(content, /__AI_BRIDGE_LOADED_V114__/);
assert.match(content, /version: "1\.14\.0"/);
assert.match(content, /AI_BRIDGE_GENERATION_STATUS/);
assert.match(content, /AI_BRIDGE_STOP_GENERATION/);
assert.match(content, /generationId: currentGenerationId/);
assert.match(background, /CONTENT_VERSION = "1\.14\.0"/);
assert.match(background, /WATCHDOG_ALARM = "ai-bridge-watchdog"/);
assert.match(background, /periodInMinutes: 1/);
assert.match(background, /chrome\.alarms\.onAlarm/);
assert.match(background, /generationId/);
assert.match(background, /Ignored late response/);
assert.match(background, /Automatic recovery attempt 1/);
assert.match(background, /nextRecoveryAttemptAllowed/);
assert.match(background, /recoveryCheckpoint/);
assert.match(readme, /Current version: 1\.14\.0/);
assert.match(readme, /chrome\.alarms/);
assert.doesNotMatch(readme, /not yet on main/i);

const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
assert.equal(ids.length, new Set(ids).size, `duplicate ids: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);

const CONTENT_SCRIPT_MESSAGE_TYPES = new Set(["AI_BRIDGE_FETCH_ARTIFACT", "AI_BRIDGE_RESPONSE"]);
assert.match(background, /CONTENT_SCRIPT_MESSAGE_TYPES = new Set\(\["AI_BRIDGE_FETCH_ARTIFACT", "AI_BRIDGE_RESPONSE"\]\)/);
assert.doesNotMatch(background, /CONTENT_SCRIPT_MESSAGE_TYPES = new Set\(\[[^\]]*AI_BRIDGE_STOP_GENERATION/);
assert.doesNotMatch(background, /msg\.type === "AI_BRIDGE_STOP_GENERATION"/);
assert.doesNotMatch(background, /msg\.type === "AI_BRIDGE_RECOVER"/);

const sandbox = {
  SIDES: ["A", "B", "C"],
  INFINITE_TURNS: -1,
  WORK_MODES: new Set(["relay", "collaborate", "compete", "parallel", "review", "mesh"]),
  ALLOWED_CLOUD_THEMES: new Set(["blizzard", "ghostwhite", "midnight", "slate", "light", "solarized", "ocean", "terminal"]),
  CLOUD_SETTINGS_VERSION: 1,
  DEFAULT_CHECKPOINT_EVERY: 5,
  DEFAULT_STUCK_MINUTES: 30,
  MAX_CHECKPOINT_CHARS: 12000,
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
    "function normalizeWorkMode(raw) { const value = String(raw || 'relay').toLowerCase(); return WORK_MODES.has(value) ? value : 'relay'; }",
    "function normalizeMaxTurns(raw) { if (raw === undefined || raw === null || raw === '') return INFINITE_TURNS; const value = Number(raw); if (!Number.isInteger(value)) throw new Error('bad'); if (value === INFINITE_TURNS) return INFINITE_TURNS; if (value < 1 || value > 10000) throw new Error('bad'); return value; }",
    extractFunction(background, "emptySideMap"),
    extractFunction(background, "normalizeActiveSides"),
    extractFunction(background, "clampCheckpointEvery"),
    extractFunction(background, "clampStuckTimeoutMinutes"),
    extractFunction(background, "checkpointDue"),
    extractFunction(background, "recordSequentialParticipation"),
    extractFunction(background, "migrateTimerState"),
    extractFunction(background, "generationMatches"),
    extractFunction(background, "shouldDeclareStuck"),
    extractFunction(background, "nextRecoveryAttemptAllowed"),
    extractFunction(background, "accumulateTotalWorkMs"),
    extractFunction(background, "newGenerationId"),
    extractFunction(background, "clampCloudPane"),
    extractFunction(background, "sanitizeHistoryForCloud"),
    extractFunction(background, "sanitizeCloudSettings"),
    "this.normalizeActiveSides = normalizeActiveSides;",
    "this.clampCheckpointEvery = clampCheckpointEvery;",
    "this.clampStuckTimeoutMinutes = clampStuckTimeoutMinutes;",
    "this.checkpointDue = checkpointDue;",
    "this.recordSequentialParticipation = recordSequentialParticipation;",
    "this.migrateTimerState = migrateTimerState;",
    "this.generationMatches = generationMatches;",
    "this.shouldDeclareStuck = shouldDeclareStuck;",
    "this.nextRecoveryAttemptAllowed = nextRecoveryAttemptAllowed;",
    "this.accumulateTotalWorkMs = accumulateTotalWorkMs;",
    "this.newGenerationId = newGenerationId;",
    "this.sanitizeCloudSettings = sanitizeCloudSettings;"
  ].join("\n"),
  sandbox
);

const {
  checkpointDue,
  recordSequentialParticipation,
  migrateTimerState,
  generationMatches,
  shouldDeclareStuck,
  nextRecoveryAttemptAllowed,
  accumulateTotalWorkMs,
  clampCheckpointEvery,
  clampStuckTimeoutMinutes,
  sanitizeCloudSettings
} = sandbox;

assert.equal(clampCheckpointEvery("nope"), 5);
assert.equal(clampCheckpointEvery(0), 1);
assert.equal(clampCheckpointEvery(1), 1);
assert.equal(clampCheckpointEvery(50), 50);
assert.equal(clampCheckpointEvery(51), 50);
assert.equal(clampStuckTimeoutMinutes("nope"), 30);
assert.equal(clampStuckTimeoutMinutes(4), 5);
assert.equal(clampStuckTimeoutMinutes(5), 5);
assert.equal(clampStuckTimeoutMinutes(120), 120);
assert.equal(clampStuckTimeoutMinutes(121), 120);

assert.equal(checkpointDue(0, 5), false);
assert.equal(checkpointDue(1, 5), true);
assert.equal(checkpointDue(2, 5), false);
assert.equal(checkpointDue(5, 5), false);
assert.equal(checkpointDue(6, 5), true);
assert.equal(checkpointDue(11, 5), true);
assert.equal(checkpointDue(1, 1), true);
assert.equal(checkpointDue(2, 1), true);

assert.equal(generationMatches("", "anything"), true);
assert.equal(generationMatches(null, "x"), true);
assert.equal(generationMatches("abc", "abc"), true);
assert.equal(generationMatches("abc", "xyz"), false);
assert.equal(generationMatches("abc", ""), false);

assert.equal(nextRecoveryAttemptAllowed(0), true);
assert.equal(nextRecoveryAttemptAllowed(1), false);
assert.equal(nextRecoveryAttemptAllowed(2), false);

assert.equal(accumulateTotalWorkMs(0, 12000), 12000);
assert.equal(accumulateTotalWorkMs(12000, 5000), 17000, "aborted attempt still counts toward Total");
assert.equal(accumulateTotalWorkMs("nope", -3), 0);

const now = Date.now();
assert.equal(shouldDeclareStuck({ startedAt: 0, lastProgressAt: now, now, timeoutMs: 30 * 60 * 1000 }), false);
assert.equal(shouldDeclareStuck({
  startedAt: now - 12 * 60 * 1000,
  lastProgressAt: now - 60 * 1000,
  now,
  timeoutMs: 30 * 60 * 1000
}), false, "visible progress must reschedule rather than declare stuck");
assert.equal(shouldDeclareStuck({
  startedAt: now - 40 * 60 * 1000,
  lastProgressAt: now - 31 * 60 * 1000,
  now,
  timeoutMs: 30 * 60 * 1000
}), true);

function simulateSequential(events, activeSides = ["A", "B", "C"]) {
  let participants = [];
  let cycleCount = 0;
  let turn = 0;
  for (const side of events) {
    turn += 1;
    const result = recordSequentialParticipation(participants, side, activeSides);
    participants = result.participants;
    if (result.cycleCompleted) cycleCount += 1;
  }
  return { cycleCount, participants, turn };
}

function simulateBatch(events, { review = false } = {}) {
  let pending = ["A", "B", "C"];
  let phase = "primary";
  let cycleCount = 0;
  let turn = 0;
  for (const side of events) {
    turn += 1;
    pending = pending.filter(item => item !== side);
    if (!pending.length) {
      if (review && phase === "primary") {
        phase = "review";
        pending = ["A", "B", "C"];
      } else {
        cycleCount += 1;
        phase = "primary";
        pending = ["A", "B", "C"];
      }
    }
  }
  return { cycleCount, phase, pending, turn };
}

function asList(value) {
  return [...(Array.isArray(value) ? value : [])];
}

const relay = simulateSequential(["A", "B", "C", "A", "B", "C"]);
assert.equal(relay.cycleCount, 2);
assert.equal(relay.turn, 6);
assert.deepEqual(asList(relay.participants), []);

const collaborate = simulateSequential(["A", "B", "C"]);
assert.equal(collaborate.cycleCount, 1);

const meshDup = simulateSequential(["A", "B", "A", "A", "C"]);
assert.equal(meshDup.cycleCount, 1, "duplicate Direct Mesh participation does not complete the cycle");
assert.deepEqual(asList(meshDup.participants), []);

const meshPartial = simulateSequential(["A", "B", "A"]);
assert.equal(meshPartial.cycleCount, 0);
assert.deepEqual(asList(meshPartial.participants), ["A", "B"]);

const compete = simulateBatch(["A", "B", "C", "A", "B", "C"]);
assert.equal(compete.cycleCount, 2);
assert.equal(compete.turn, 6);

const parallelHalf = simulateBatch(["A", "B"]);
assert.equal(parallelHalf.cycleCount, 0);
assert.deepEqual(asList(parallelHalf.pending), ["C"]);

const reviewOne = simulateBatch(["A", "B", "C", "A", "B", "C"], { review: true });
assert.equal(reviewOne.cycleCount, 1, "Peer Review increments only after primary+critique");
assert.equal(reviewOne.phase, "primary");

const reviewPrimaryOnly = simulateBatch(["A", "B", "C"], { review: true });
assert.equal(reviewPrimaryOnly.cycleCount, 0);
assert.equal(reviewPrimaryOnly.phase, "review");

const live = migrateTimerState({ sessionActive: true, maxTurns: 9, turn: 8, workMode: "relay" });
assert.equal(live.cycleCount, 0);
assert.equal(live.maxCycles, -1, "do not convert a live per-response budget mid-run");

const idleRelay = migrateTimerState({ sessionActive: false, maxTurns: 12, turn: 9, workMode: "relay" });
assert.equal(idleRelay.cycleCount, 3);
assert.equal(idleRelay.maxCycles, 12);

const idleReview = migrateTimerState({ sessionActive: false, maxTurns: 6, turn: 9, workMode: "review" });
assert.equal(idleReview.cycleCount, 1);

const persisted = migrateTimerState({
  sessionActive: true,
  cycleCount: 4,
  maxCycles: 20,
  maxTurns: 9,
  turn: 12,
  activeSides: ["C", "A", "A"]
});
assert.equal(persisted.cycleCount, 4, "persisted cycleCount survives worker suspension");
assert.equal(persisted.maxCycles, 20);
assert.deepEqual(asList(persisted.activeSides), ["C", "A"]);

const cloud = sanitizeCloudSettings({
  theme: "ocean",
  maxTurns: 8,
  maxCycles: 8,
  checkpointEveryNCycles: 5,
  stuckTimeoutMinutes: 30,
  recoveryCheckpoint: { text: "do not sync this", cycleCount: 4 },
  cycleCount: 4,
  cycleParticipants: ["A"],
  generationIdBySide: { A: "A-1" },
  lastSentBySide: { A: "secret prompt" },
  transcript: [{ text: "nope" }],
  tabA: 7
});
assert.equal(cloud.maxCycles, 8);
assert.equal(cloud.checkpointEveryNCycles, 5);
assert.equal(cloud.stuckTimeoutMinutes, 30);
assert.equal(cloud.recoveryCheckpoint, undefined);
assert.equal(cloud.cycleCount, undefined);
assert.equal(cloud.generationIdBySide, undefined);
assert.equal(cloud.lastSentBySide, undefined);
assert.equal(cloud.transcript, undefined);
assert.equal(cloud.tabA, undefined);
assert.doesNotMatch(JSON.stringify(cloud), /do not sync this/);

const checkpointFn = extractFunction(background, "handleCheckpointResponse");
assert.doesNotMatch(checkpointFn, /state\.cycleCount = \(Number\(state\.cycleCount\) \|\| 0\) \+ 1/);
assert.doesNotMatch(checkpointFn, /recordSequentialParticipation/);
assert.match(checkpointFn, /storeRecoveryCheckpoint/);

const recoverFn = extractFunction(background, "recoverStuckSide");
assert.match(recoverFn, /nextRecoveryAttemptAllowed/);
assert.match(recoverFn, /AI_BRIDGE_STOP_GENERATION/);
assert.match(recoverFn, /resetChatTab/);
assert.match(recoverFn, /sourceDeliveredBySide\[side\] = false/);
assert.match(recoverFn, /recovery: true/);
assert.match(recoverFn, /queueHumanRequest/);

const watchdogFn = extractFunction(background, "runWatchdogTick");
assert.match(watchdogFn, /queryGenerationStatus/);
assert.match(watchdogFn, /lastProgressAtBySide/);
assert.match(watchdogFn, /skipStalledCheckpoint/);
assert.match(watchdogFn, /recoverStuckSide/);

assert.match(background, /ensureWatchdogAlarm/);
assert.match(background, /clearWatchdogAlarm/);
assert.match(background, /settleRunningTimers/);
assert.match(dashboardJs, /every selected LLM has participated/);
assert.match(dashboardJs, /full primary\+critique pass/);

console.log("v1.14 timers/recovery ok");
