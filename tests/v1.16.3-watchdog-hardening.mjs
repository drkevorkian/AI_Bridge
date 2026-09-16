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
assert.doesNotMatch(source, /state\.activeSides\s*=/, "V2 watchdog must not swap configured activeSides");
assert.match(source, /enqueueCoordinatorMutation/, "V2 watchdog must use the coordinator mutation queue");

const context = vm.createContext({
  globalThis: null,
  Date,
  Map,
  Set,
  Promise,
  state: {
    sessionActive: true,
    running: true,
    awaitingHuman: false,
    workMode: "relay",
    currentSide: "B",
    activeSides: ["A", "B", "C"],
    phasePendingSides: [],
    generationIdBySide: { A: "ga", B: "gb", C: "gc" },
    roundStartedAtBySide: { A: 100, B: 100, C: 100 },
    lastProgressAtBySide: { A: 0, B: 0, C: 0 },
    stuckTimeoutMinutes: 30,
    checkpointPending: false
  },
  SIDES: ["A", "B", "C"],
  isBatchWorkMode() { return ["compete", "parallel", "review"].includes(context.state.workMode); },
  async queryGenerationStatus() { return { ok: true, generating: true, pendingSend: true, lastChangeAt: 123 }; },
  enqueueCoordinatorMutation(task) { return Promise.resolve().then(task); },
  clampStuckTimeoutMinutes() { return 30; },
  shouldDeclareStuck() { return false; },
  generationMatches(expected, incoming) { return Boolean(expected && incoming && expected === incoming); },
  async skipStalledCheckpoint() { return { skipped: true }; },
  async recoverStuckSide() { return { recovered: true }; },
  async saveState() {}
});
context.globalThis = context;
vm.runInContext(source, context, { filename: "watchdog-runtime-hardening.js" });

// pendingSend remains diagnostic state but may not masquerade as model progress.
const pendingStatus = await context.queryGenerationStatus("B");
assert.equal(pendingStatus.pendingSend, true);
assert.equal(pendingStatus.generating, false, "pendingSend alone must not count as model-generation progress");
assert.equal(pendingStatus.sending, true);

let result = await context.runWatchdogTick(500);
assert.deepEqual(result.results.map(item => item.side), ["B"], "sequential watchdog must inspect currentSide only");
assert.deepEqual([...context.state.activeSides], ["A", "B", "C"], "watchdog must never rewrite configured team membership");

context.state.workMode = "parallel";
context.state.currentSide = null;
context.state.phasePendingSides = ["A", "C", "A"];
result = await context.runWatchdogTick(600);
assert.deepEqual(result.results.map(item => item.side), ["A", "C"], "batch watchdog must inspect pending phase sides only");
assert.deepEqual([...context.state.activeSides], ["A", "B", "C"]);

context.state.awaitingHuman = true;
result = await context.runWatchdogTick(700);
assert.equal(result.checked, false, "watchdog must stay idle while human input is pending");

assert.equal(context.__AI_BRIDGE_WATCHDOG_SECURITY__.version, 2);
assert.equal(context.__AI_BRIDGE_WATCHDOG_SECURITY__.sharedCoordinatorQueue, true);
assert.equal(context.__AI_BRIDGE_WATCHDOG_SECURITY__.mutatesActiveSidesForFiltering, false);
assert.equal(context.__AI_BRIDGE_WATCHDOG_SECURITY__.providerProbeOutsideQueue, true);

console.log("v1.16.4 watchdog hardening regression checks passed.");
