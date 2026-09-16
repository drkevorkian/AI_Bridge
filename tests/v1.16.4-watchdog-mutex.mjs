import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const mutexSource = fs.readFileSync(new URL("../coordinator-mutex-prelude.js", import.meta.url), "utf8");
const watchdogSource = fs.readFileSync(new URL("../watchdog-runtime-hardening.js", import.meta.url), "utf8");

// Source-level guard: the watchdog must never reintroduce the old temporary
// activeSides swap that created the race in the first place.
assert.doesNotMatch(watchdogSource, /state\.activeSides\s*=/, "watchdog must not rewrite state.activeSides");
assert.match(watchdogSource, /enqueueCoordinatorMutation/, "watchdog must use the shared coordinator queue");
assert.match(watchdogSource, /collectProviderProbes/, "provider probes must be a separate unlocked phase");

// Verify that the exported queue and runtime-message serialization are the
// exact same FIFO chain rather than independent locks.
{
  let registeredListener = null;
  const order = [];
  let releaseWatchdog;
  const watchdogGate = new Promise(resolve => { releaseWatchdog = resolve; });

  const context = vm.createContext({
    console,
    Promise,
    TypeError,
    globalThis: null,
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            registeredListener = listener;
          }
        }
      }
    }
  });
  context.globalThis = context;
  vm.runInContext(mutexSource, context, { filename: "coordinator-mutex-prelude.js" });

  assert.equal(typeof context.enqueueCoordinatorMutation, "function");
  assert.equal(context.__AI_BRIDGE_COORDINATOR_MUTEX__.version, 2);

  // Register one normal coordinator listener after the prelude has wrapped the API.
  context.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    order.push(`message:${message.type}`);
    sendResponse({ ok: true });
    return true;
  });

  const watchdogTask = context.enqueueCoordinatorMutation(async () => {
    order.push("watchdog:start");
    await watchdogGate;
    order.push("watchdog:end");
  });

  const responsePromise = new Promise(resolve => {
    registeredListener({ type: "AI_BRIDGE_RESPONSE" }, {}, result => {
      order.push("response:ack");
      resolve(result);
    });
  });

  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(order, ["watchdog:start"], "response entered while watchdog mutation still held the queue");

  releaseWatchdog();
  await watchdogTask;
  const response = await responsePromise;
  assert.equal(response.ok, true);
  assert.deepEqual(order, ["watchdog:start", "watchdog:end", "message:AI_BRIDGE_RESPONSE", "response:ack"]);
}

// Verify the watchdog performs slow generation-status probes outside the lock,
// then rejects their result if RESPONSE-like state changes occurred meanwhile.
{
  let resolveProbe;
  const probeGate = new Promise(resolve => { resolveProbe = resolve; });
  let recoverCalls = 0;
  let saveCalls = 0;

  const state = {
    sessionActive: true,
    running: true,
    awaitingHuman: false,
    currentSide: "A",
    phasePendingSides: [],
    activeSides: ["A", "B", "C"],
    generationIdBySide: { A: "A-gen-1", B: null, C: null },
    roundStartedAtBySide: { A: 1000, B: null, C: null },
    lastProgressAtBySide: { A: 1000, B: null, C: null },
    stuckTimeoutMinutes: 5,
    checkpointPending: false
  };

  const context = vm.createContext({
    console,
    Promise,
    Date,
    Map,
    Set,
    globalThis: null,
    state,
    SIDES: ["A", "B", "C"],
    isBatchWorkMode: () => false,
    queryGenerationStatus: async () => probeGate,
    enqueueCoordinatorMutation: task => Promise.resolve().then(task),
    clampStuckTimeoutMinutes: () => 5,
    shouldDeclareStuck: () => true,
    generationMatches: (expected, incoming) => Boolean(expected && incoming && expected === incoming),
    skipStalledCheckpoint: async () => ({ skipped: true }),
    recoverStuckSide: async () => {
      recoverCalls += 1;
      return { recovered: true };
    },
    saveState: async () => { saveCalls += 1; }
  });
  context.globalThis = context;
  vm.runInContext(watchdogSource, context, { filename: "watchdog-runtime-hardening.js" });

  const originalActiveSides = [...state.activeSides];
  const tickPromise = context.runWatchdogTick(1_000_000);

  // Allow snapshot acquisition and let the unlocked provider probe begin.
  await new Promise(resolve => setTimeout(resolve, 0));

  // Simulate an overlapping committed RESPONSE/new send while the probe is in flight.
  state.generationIdBySide.A = "A-gen-2";
  state.roundStartedAtBySide.A = 2000;
  resolveProbe({ ok: true, generating: false, lastChangeAt: 1000 });

  const result = await tickPromise;
  assert.equal(result.checked, true);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].side, "A");
  assert.equal(result.results[0].staleProbe, true, "stale provider probe was allowed to commit recovery");
  assert.equal(recoverCalls, 0, "watchdog recovered a generation that changed during the unlocked probe");
  assert.equal(saveCalls, 0, "stale probe mutated progress state");
  assert.deepEqual(state.activeSides, originalActiveSides, "watchdog changed configured team membership");
  assert.equal(context.__AI_BRIDGE_WATCHDOG_SECURITY__.sharedCoordinatorQueue, true);
  assert.equal(context.__AI_BRIDGE_WATCHDOG_SECURITY__.mutatesActiveSidesForFiltering, false);
  assert.equal(context.__AI_BRIDGE_WATCHDOG_SECURITY__.providerProbeOutsideQueue, true);
}

console.log("v1.16.4 watchdog/coordinator serialization regression passed");
