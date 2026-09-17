import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const dashboardJs = fs.readFileSync(path.join(root, "dashboard.js"), "utf8");
const html = fs.readFileSync(path.join(root, "dashboard.html"), "utf8");
const mutex = fs.readFileSync(path.join(root, "coordinator-mutex-prelude.js"), "utf8");
const hardening = fs.readFileSync(path.join(root, "manual-relay-runtime-hardening.js"), "utf8");

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

assert.match(content, /AI_BRIDGE_CAPTURE_LATEST/);
assert.match(content, /async function captureLatestVisibleReply\(/);
assert.match(background, /AI_BRIDGE_FORCE_RELAY/);
assert.match(background, /requireExtensionPage\(sender, "Manual relay"\)/);
assert.match(background, /async function forceRelayCapturedResponse\(/);
assert.match(background, /function sanitizeForceRelaySides\(/);
assert.match(background, /function manualRelayMessage\(/);
assert.match(background, /MANUAL RELAY FROM AI/);
assert.match(background, /wrapUntrustedPeerData\(fromSide,/);
assert.match(mutex, /AI_BRIDGE_FORCE_RELAY/);
assert.match(hardening, /rejectsStreamingCapture:\s*true/);
assert.match(hardening, /generationAwareIdentity:\s*true/);
assert.match(hardening, /sequentialFanoutSafe:\s*true/);
assert.match(hardening, /sequentialCursorGate:\s*true/);
assert.match(hardening, /batchPendingTargetGate:\s*true/);
assert.match(hardening, /one coordinator cursor/i);
assert.match(hardening, /abandon the coordinator cursor/i);
assert.match(hardening, /result\.generationId/);
assert.match(html, /id="forceRelayBtn"/);
assert.match(html, /id="forceFromA"/);
assert.match(html, /id="forceToC"/);
assert.match(html, /id="useLastA"/);
assert.match(dashboardJs, /AI_BRIDGE_FORCE_RELAY/);
assert.match(dashboardJs, /selectedForceTargets/);
assert.doesNotMatch(dashboardJs, /innerHTML/);

const sandbox = { SIDES: ["A", "B", "C"] };
vm.runInNewContext(
  [
    extractFunction(background, "sanitizeForceRelaySides"),
    "this.sanitizeForceRelaySides = sanitizeForceRelaySides;"
  ].join("\n"),
  sandbox
);

assert.equal(JSON.stringify(sandbox.sanitizeForceRelaySides(["B", "c", "B", "Z", "a"])), JSON.stringify(["B", "C", "A"]));
assert.equal(JSON.stringify(sandbox.sanitizeForceRelaySides("b")), JSON.stringify(["B"]));
assert.equal(JSON.stringify(sandbox.sanitizeForceRelaySides(["", null, "Q"])), JSON.stringify([]));
assert.equal(JSON.stringify(sandbox.sanitizeForceRelaySides(["A", "B", "C"])), JSON.stringify(["A", "B", "C"]));

// Sequential Manual Relay must never send a prompt to a side whose eventual
// reply the coordinator cursor would discard. Preserve the current cursor when
// capturing a stale/non-current source, but allow a current source to advance it.
{
  const deliveries = [];
  const relaySandbox = {
    console,
    Promise,
    Date,
    Math,
    Map,
    Set,
    String,
    Number,
    Array,
    SIDES: ["A", "B", "C"],
    MAX_FORCE_RELAY_CHARS: 200000,
    state: {
      workMode: "relay",
      currentSide: "B",
      lastResponseBySide: {},
      phasePendingSides: []
    },
    sanitizeForceRelaySides: sandbox.sanitizeForceRelaySides,
    isSequentialWorkMode: mode => mode === "relay",
    isBatchWorkMode: () => false,
    tabForSide: () => 101,
    ensureTabListener: async () => {},
    chrome: {
      tabs: {
        sendMessage: async () => ({
          ok: true,
          text: "captured response",
          artifacts: [],
          generationId: "generation-1",
          generating: false,
          completedAt: 1
        })
      }
    },
    captureLatestFromSide: async () => ({ ok: true }),
    forceRelayCapturedResponse: async (source, targets) => {
      deliveries.push({ source, targets: [...targets] });
      return { ok: true, delivered: [...targets] };
    }
  };
  relaySandbox.globalThis = relaySandbox;
  vm.createContext(relaySandbox);
  vm.runInContext(hardening, relaySandbox, { filename: "manual-relay-runtime-hardening.js" });

  await assert.rejects(
    () => relaySandbox.forceRelayCapturedResponse("A", ["C"]),
    /abandon the coordinator cursor at AI B/i
  );
  assert.equal(deliveries.length, 0, "unsafe sequential relay must fail before sending anything");

  const staleToCurrent = await relaySandbox.forceRelayCapturedResponse("A", ["B"]);
  assert.equal(staleToCurrent.ok, true);
  assert.deepEqual(deliveries.at(-1), { source: "A", targets: ["B"] });

  const currentToNext = await relaySandbox.forceRelayCapturedResponse("B", ["C"]);
  assert.equal(currentToNext.ok, true);
  assert.deepEqual(deliveries.at(-1), { source: "B", targets: ["C"] });
}

console.log("v1.17 manual relay safety regression passed.");
