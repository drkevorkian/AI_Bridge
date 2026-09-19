import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hardening = fs.readFileSync(path.join(root, "completion-runtime-hardening.js"), "utf8");
const popup = fs.readFileSync(path.join(root, "popup.js"), "utf8");

assert.match(hardening, /liveSidesForCompletionHolds/);
assert.doesNotMatch(
  hardening.replace(/function liveSidesForCompletionHolds[\s\S]*?\n  \}/, ""),
  /const tasks = \["A", "B", "C"\]\.map/
);
assert.match(popup, /s\?\.activeSides/);

function loadHardening({ sides, tabs }) {
  const cancelMessages = [];
  const state = {};
  for (const [side, tabId] of Object.entries(tabs)) state[`tab${side}`] = tabId;
  const sandbox = {
    console: { warn() {} },
    Date, Map, Number, Promise, String,
    SIDES: sides,
    state,
    appendLog() {},
    chrome: {
      scripting: { executeScript: async () => {} },
      tabs: {
        sendMessage: async (tabId, msg) => {
          if (msg?.type === "AI_BRIDGE_CANCEL_COMPLETION_HOLDS") {
            cancelMessages.push({ tabId, reason: msg.reason });
          }
          return { ok: true, patched: true, version: "1.16.3" };
        }
      }
    },
    ensureTabListener: async tabId => ({ ok: true, tabId }),
    sendToSide: async () => ({ sent: true }),
    handleCompletedResponse: async () => ({ ok: true }),
    pauseBridge: async () => ({ paused: true }),
    endBridge: async () => ({ ended: true })
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(hardening, sandbox);
  return { sandbox, cancelMessages };
}

const five = loadHardening({
  sides: ["A", "B", "C", "D", "E"],
  tabs: { A: 11, B: 12, C: 13, D: 14, E: 15 }
});
await five.sandbox.pauseBridge("pause");
assert.deepEqual(
  five.cancelMessages.map(item => item.tabId).sort((a, b) => a - b),
  [11, 12, 13, 14, 15],
  "pause must cancel completion holds on D/E as well as A/B/C"
);

const fallback = loadHardening({
  sides: undefined,
  tabs: { A: 21, B: 22, C: 23, D: 24 }
});
await fallback.sandbox.endBridge("stop");
assert.deepEqual(
  fallback.cancelMessages.map(item => item.tabId).sort((a, b) => a - b),
  [21, 22, 23],
  "missing SIDES must keep the legacy A/B/C cancel path"
);

console.log("dynamic-completion-holds: ok");
