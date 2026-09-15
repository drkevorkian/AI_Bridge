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

const context = vm.createContext({
  globalThis: null,
  Date,
  Set,
  state: {
    sessionActive: true,
    running: true,
    awaitingHuman: false,
    workMode: "relay",
    currentSide: "B",
    activeSides: ["A", "B", "C"],
    phasePendingSides: []
  },
  SIDES: ["A", "B", "C"],
  isBatchWorkMode() { return ["compete", "parallel", "review"].includes(context.state.workMode); },
  async queryGenerationStatus() { return { ok: true, generating: true, pendingSend: true, lastChangeAt: 123 }; },
  async runWatchdogTick() { return { observedSides: [...context.state.activeSides], status: await context.queryGenerationStatus(context.state.activeSides[0]) }; }
});
context.globalThis = context;
vm.runInContext(source, context, { filename: "watchdog-runtime-hardening.js" });

let result = await context.runWatchdogTick(500);
assert.deepEqual([...result.observedSides], ["B"], "sequential watchdog must inspect currentSide only");
assert.equal(result.status.pendingSend, true);
assert.equal(result.status.generating, false, "pendingSend alone must not count as model-generation progress");
assert.equal(result.status.sending, true);
assert.deepEqual([...context.state.activeSides], ["A", "B", "C"], "configured active team must be restored after watchdog tick");

context.state.workMode = "parallel";
context.state.currentSide = null;
context.state.phasePendingSides = ["A", "C", "A"];
result = await context.runWatchdogTick(600);
assert.deepEqual([...result.observedSides], ["A", "C"], "batch watchdog must inspect pending phase sides only");
assert.deepEqual([...context.state.activeSides], ["A", "B", "C"]);

context.state.awaitingHuman = true;
result = await context.runWatchdogTick(700);
assert.equal(result.checked, false, "watchdog must stay idle while human input is pending");

console.log("v1.16.3 watchdog hardening regression checks passed.");
