import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hardening = fs.readFileSync(path.join(root, "completion-runtime-hardening.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

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

assert.match(
  wrapper,
  /importScripts\("background\.js",\s*"completion-runtime-hardening\.js",\s*"oauth-runtime-hardening\.js",\s*"power\.js"\)/
);
assert.match(hardening, /const STALE_BASELINE_WINDOW_MS = 1200/);
assert.match(hardening, /state\?\.lastResponseBySide/);
assert.match(hardening, /state\?\.generationIdBySide/);
assert.match(hardening, /baseHandleCompletedResponse/);
assert.match(hardening, /staleBaseline: true/);
assert.doesNotMatch(hardening, /innerHTML|eval\s*\(|new Function/);

// Pure classifier boundary tests.
const classifierSandbox = { Math, Number, String, STALE_BASELINE_WINDOW_MS: 1200 };
vm.runInNewContext(
  `${extractFunction(hardening, "aiBridgeLooksLikeStaleBaseline")}\nthis.check = aiBridgeLooksLikeStaleBaseline;`,
  classifierSandbox
);

const check = classifierSandbox.check;
assert.equal(check({ previousText: "old answer", incomingText: "old answer", startedAt: 10_000, completedAt: 10_050 }), true);
assert.equal(check({ previousText: "old answer", incomingText: "old answer", startedAt: 10_000, completedAt: 9_100 }), true);
assert.equal(check({ previousText: "old answer", incomingText: "old answer", startedAt: 10_000, completedAt: 11_199 }), true);
assert.equal(check({ previousText: "old answer", incomingText: "old answer", startedAt: 10_000, completedAt: 11_201 }), false);
assert.equal(check({ previousText: "old answer", incomingText: "new answer", startedAt: 10_000, completedAt: 10_050 }), false);
assert.equal(check({ previousText: "", incomingText: "", startedAt: 10_000, completedAt: 10_050 }), false);
assert.equal(check({ previousText: "same", incomingText: "same", startedAt: 0, completedAt: 10_050 }), false);
assert.equal(check({ previousText: "same", incomingText: "same", startedAt: 10_000, completedAt: NaN }), false);

// Runtime integration: sendToSide captures the previous response before the
// core runtime clears it, stale prior DOM text is rejected, and the actual new
// response continues through the original handler.
const accepted = [];
const runtimeState = {
  lastResponseBySide: { A: "previous answer" },
  generationIdBySide: { A: null },
  roundStartedAtBySide: { A: null }
};
const runtimeSandbox = {
  console: { warn() {} },
  Date,
  Map,
  Math,
  Number,
  String,
  state: runtimeState,
  appendLog() {},
  sendToSide: async side => {
    runtimeState.generationIdBySide[side] = "gen-A-2";
    runtimeState.roundStartedAtBySide[side] = 50_000;
    delete runtimeState.lastResponseBySide[side];
    return { sent: true };
  },
  handleCompletedResponse: async (side, text, options) => {
    accepted.push({ side, text, options });
    return { ok: true };
  }
};
vm.runInNewContext(hardening, runtimeSandbox);
await runtimeSandbox.sendToSide("A", "new prompt", {});

let result = await runtimeSandbox.handleCompletedResponse("A", "previous answer", {
  generationId: "gen-A-2",
  completedAt: 50_400
});
assert.equal(result.staleBaseline, true);
assert.equal(accepted.length, 0);

result = await runtimeSandbox.handleCompletedResponse("A", "actual new answer", {
  generationId: "gen-A-2",
  completedAt: 54_000
});
assert.equal(result.ok, true);
assert.equal(accepted.length, 1);
assert.equal(accepted[0].text, "actual new answer");

console.log("v1.16.3 stale-completion baseline regression ok");
