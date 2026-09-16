import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "watchdog-runtime-hardening.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

assert.match(wrapper, /importScripts\("watchdog-runtime-hardening\.js"\)/);
assert.match(wrapper, /pendingSendCountsAsModelProgress\s*!==\s*false/);
assert.match(wrapper, /serializedWithCoordinator\s*!==\s*true/);
assert.match(wrapper, /mutatesActiveSides\s*!==\s*false/);

const probeCalls = [];
const context = vm.createContext({
  globalThis: null,
  Date,
  Map,
  Set,
  Object,
  Promise,
  state: {
    sessionActive: true,
    running: true,
    awaitingHuman: false,
    workMode: "relay",
    currentSide: "B",
    activeSides: ["A", "B", "C"],
    phasePendingSides: [],
    generationIdBySide: { A: "gen-a", B: "gen-b", C: "gen-c" },
    roundStartedAtBySide: { A: 1, B: 1, C: 1 },
    lastProgressAtBySide: { A: null, B: null, C: null },
    checkpointPending: false,
    checkpointRequestId: null,
    stuckTimeoutMinutes: 30
  },
  SIDES: ["A", "B", "C"],
  isBatchWorkMode() { return ["compete", "parallel", "review"].includes(context.state.workMode); },
  async queryGenerationStatus(side) {
    probeCalls.push(side);
    return { ok: true, generating: true, pendingSend: true, lastChangeAt: 123 };
  },
  async runWatchdogTick() { return { checked: false }; },
  clampStuckTimeoutMinutes() { return 30; },
  shouldDeclareStuck() { return false; },
  generationMatches(expected, incoming) { return Boolean(expected && incoming && expected === incoming); },
  async saveState() {},
  async skipStalledCheckpoint() { return { skipped: true }; },
  async recoverStuckSide() { return { recovered: true }; },
  async enqueueCoordinatorMutation(task) { return task(); }
});
context.globalThis = context;
vm.runInContext(source, context, { filename: "watchdog-runtime-hardening.js" });

const transformed = await context.queryGenerationStatus("B");
assert.equal(transformed.pendingSend, true);
assert.equal(transformed.generating, false, "pendingSend alone must not count as model-generation progress");
assert.equal(transformed.sending, true);
probeCalls.length = 0;

let result = await context.runWatchdogTick(500);
assert.equal(result.checked, true);
assert.deepEqual(probeCalls, ["B"], "sequential watchdog must probe currentSide only");
assert.deepEqual([...context.state.activeSides], ["A", "B", "C"], "watchdog must never mutate configured team membership");

probeCalls.length = 0;
context.state.workMode = "parallel";
context.state.currentSide = null;
context.state.phasePendingSides = ["A", "C", "A"];
result = await context.runWatchdogTick(600);
assert.equal(result.checked, true);
assert.deepEqual(probeCalls, ["A", "C"], "batch watchdog must probe pending phase sides only");
assert.deepEqual([...context.state.activeSides], ["A", "B", "C"]);

context.state.awaitingHuman = true;
result = await context.runWatchdogTick(700);
assert.equal(result.checked, false, "watchdog must stay idle while human input is pending");

assert.equal(context.__AI_BRIDGE_WATCHDOG_SECURITY__.serializedWithCoordinator, true);
assert.equal(context.__AI_BRIDGE_WATCHDOG_SECURITY__.mutatesActiveSides, false);
console.log("v1.16.4 watchdog hardening regression checks passed.");
