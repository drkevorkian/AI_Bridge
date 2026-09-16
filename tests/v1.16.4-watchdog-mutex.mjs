import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const mutexSource = fs.readFileSync(path.join(root, "coordinator-mutex-prelude.js"), "utf8");
const watchdogSource = fs.readFileSync(path.join(root, "watchdog-runtime-hardening.js"), "utf8");

assert.match(mutexSource, /globalThis\.enqueueCoordinatorMutation\s*=\s*enqueueCoordinatorMutation/);
assert.match(watchdogSource, /serializedWithCoordinator:\s*true/);
assert.doesNotMatch(watchdogSource, /state\.activeSides\s*=\s*expected/);
assert.doesNotMatch(watchdogSource, /configuredActiveSides/);

const listeners = [];
const events = [];
let responseObservedSides = null;
let releaseRecovery;
let recoveryStartedResolve;
const recoveryStarted = new Promise(resolve => { recoveryStartedResolve = resolve; });
const recoveryGate = new Promise(resolve => { releaseRecovery = resolve; });

const chrome = {
  runtime: {
    onMessage: {
      addListener(listener) {
        listeners.push(listener);
        return undefined;
      }
    }
  }
};

const state = {
  sessionActive: true,
  running: true,
  awaitingHuman: false,
  workMode: "relay",
  currentSide: "A",
  phasePendingSides: [],
  activeSides: ["A", "B", "C"],
  generationIdBySide: { A: "gen-a", B: null, C: null },
  roundStartedAtBySide: { A: 1, B: null, C: null },
  lastProgressAtBySide: { A: null, B: null, C: null },
  checkpointPending: false,
  checkpointRequestId: null,
  stuckTimeoutMinutes: 5
};

const context = vm.createContext({
  console,
  Promise,
  Object,
  Set,
  TypeError,
  Date,
  chrome,
  state,
  SIDES: ["A", "B", "C"],
  isBatchWorkMode: () => false,
  clampStuckTimeoutMinutes: () => 5,
  shouldDeclareStuck: () => true,
  generationMatches: (expected, incoming) => Boolean(expected && incoming && expected === incoming),
  saveState: async () => {},
  skipStalledCheckpoint: async () => ({ skipped: true }),
  recoverStuckSide: async side => {
    events.push(`watchdog-start:${side}`);
    recoveryStartedResolve();
    await recoveryGate;
    events.push(`watchdog-end:${side}`);
    return { recovered: true };
  },
  queryGenerationStatus: async side => ({
    ok: true,
    side,
    generating: false,
    pendingSend: false,
    lastChangeAt: 0
  }),
  runWatchdogTick: async () => ({ checked: false })
});
context.globalThis = context;

vm.runInContext(mutexSource, context, { filename: "coordinator-mutex-prelude.js" });
assert.equal(typeof context.enqueueCoordinatorMutation, "function");
assert.equal(context.__AI_BRIDGE_COORDINATOR_MUTEX__.version, 2);

// Register a representative response listener after the prelude so it is
// serialized through the exact same queue as watchdog recovery.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "AI_BRIDGE_RESPONSE") return false;
  responseObservedSides = [...state.activeSides];
  events.push("response");
  sendResponse({ ok: true });
  return true;
});

vm.runInContext(watchdogSource, context, { filename: "watchdog-runtime-hardening.js" });
assert.equal(context.__AI_BRIDGE_WATCHDOG_SECURITY__.serializedWithCoordinator, true);
assert.equal(context.__AI_BRIDGE_WATCHDOG_SECURITY__.mutatesActiveSides, false);

const tickPromise = context.runWatchdogTick(10_000_000);
await recoveryStarted;

assert.deepEqual(state.activeSides, ["A", "B", "C"], "watchdog must never replace team membership");
assert.equal(listeners.length, 1);

let responseValue = null;
listeners[0]({ type: "AI_BRIDGE_RESPONSE" }, {}, value => { responseValue = value; });

// The response is queued behind the active watchdog recovery mutation.
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(events, ["watchdog-start:A"]);
assert.equal(responseValue, null);

releaseRecovery();
const tickResult = await tickPromise;
await new Promise(resolve => setTimeout(resolve, 0));

assert.equal(tickResult.checked, true);
assert.deepEqual(events, ["watchdog-start:A", "watchdog-end:A", "response"]);
assert.deepEqual(responseObservedSides, ["A", "B", "C"], "response must observe configured team membership");
assert.deepEqual(responseValue, { ok: true });
assert.deepEqual(state.activeSides, ["A", "B", "C"]);

// Generation revalidation: if the turn changes while the status probe is in
// flight, watchdog recovery must be discarded rather than touching the new turn.
let resolveProbe;
context.queryGenerationStatus = () => new Promise(resolve => { resolveProbe = resolve; });
state.generationIdBySide.A = "gen-old";
const staleTick = context.runWatchdogTick(20_000_000);
await new Promise(resolve => setTimeout(resolve, 0));
state.generationIdBySide.A = "gen-new";
resolveProbe({ ok: true, generating: false, pendingSend: false, lastChangeAt: 0 });
const staleResult = await staleTick;
assert.equal(staleResult.checked, true);
assert.equal(Array.isArray(staleResult.results), true);
assert.equal(staleResult.results.length, 0);

console.log("v1.16.4 watchdog mutex regression: ok");
