import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hardening = fs.readFileSync(path.join(root, "completion-runtime-hardening.js"), "utf8");
const guard = fs.readFileSync(path.join(root, "content-completion-guard.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");
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

assert.match(
  wrapper,
  /importScripts\("background\.js",\s*"completion-runtime-hardening\.js",\s*"oauth-runtime-hardening\.js",\s*"power\.js"\)/
);
assert.deepEqual(
  manifest.content_scripts?.[0]?.js,
  ["content-completion-guard.js", "content.js"],
  "DOM completion guard must load before the provider runtime"
);
assert.match(hardening, /GUARD_FILE = "content-completion-guard\.js"/);
assert.match(hardening, /GUARD_VERSION = "1\.16\.3"/);
assert.match(hardening, /AI_BRIDGE_CANCEL_COMPLETION_HOLDS/);
assert.match(hardening, /status\?\.version !== GUARD_VERSION/);
assert.match(hardening, /Completion guard could not be established/);
assert.match(hardening, /completed < start/);
assert.match(hardening, /state\?\.lastResponseBySide/);
assert.match(hardening, /baseHandleCompletedResponse/);
assert.match(hardening, /staleBaseline: true/);
assert.match(guard, /holdStaleResponse/);
assert.match(guard, /cancelAllHolds/);
assert.match(guard, /sameNode && sameText && !baseline\.changed/);
assert.match(guard, /artifacts: \[\]/);
assert.match(guard, /MutationObserver/);
assert.match(guard, /AI_BRIDGE_COMPLETION_GUARD_STATUS/);
assert.match(guard, /AI_BRIDGE_CANCEL_COMPLETION_HOLDS/);
assert.doesNotMatch(`${hardening}\n${guard}`, /innerHTML|eval\s*\(|new Function/);

const classifierSandbox = { Number, String };
vm.runInNewContext(
  `${extractFunction(hardening, "aiBridgeLooksLikeStaleBaseline")}\nthis.check = aiBridgeLooksLikeStaleBaseline;`,
  classifierSandbox
);
const check = classifierSandbox.check;
assert.equal(check({ previousText: "same", incomingText: "same", startedAt: 10_000, completedAt: 9_999 }), true);
assert.equal(check({ previousText: "same", incomingText: "same", startedAt: 10_000, completedAt: 10_000 }), false);
assert.equal(check({ previousText: "same", incomingText: "same", startedAt: 10_000, completedAt: 10_001 }), false);
assert.equal(check({ previousText: "same", incomingText: "different", startedAt: 10_000, completedAt: 9_999 }), false);
assert.equal(check({ previousText: "", incomingText: "", startedAt: 10_000, completedAt: 9_999 }), false);

const accepted = [];
const runtimeState = {
  lastResponseBySide: { A: "previous answer" },
  generationIdBySide: { A: null },
  roundStartedAtBySide: { A: null },
  tabA: 101,
  tabB: 102,
  tabC: 103
};
const injected = [];
const cancelMessages = [];
let guardStatusVersion = "1.16.3";
let pauseCalls = 0;
let endCalls = 0;
const runtimeSandbox = {
  console: { warn() {} },
  Date,
  Map,
  Number,
  Promise,
  String,
  state: runtimeState,
  appendLog() {},
  chrome: {
    scripting: { executeScript: async payload => { injected.push(payload); } },
    tabs: {
      sendMessage: async (tabId, msg) => {
        if (msg?.type === "AI_BRIDGE_COMPLETION_GUARD_STATUS") {
          return { ok: true, patched: true, version: guardStatusVersion };
        }
        if (msg?.type === "AI_BRIDGE_CANCEL_COMPLETION_HOLDS") {
          cancelMessages.push({ tabId, reason: msg.reason });
          return { ok: true, cancelled: 1, version: "1.16.3" };
        }
        return { ok: true };
      }
    }
  },
  ensureTabListener: async tabId => ({ ok: true, tabId }),
  sendToSide: async side => {
    runtimeState.generationIdBySide[side] = "gen-A-2";
    runtimeState.roundStartedAtBySide[side] = 50_000;
    delete runtimeState.lastResponseBySide[side];
    return { sent: true };
  },
  handleCompletedResponse: async (side, text, options) => {
    accepted.push({ side, text, options });
    return { ok: true };
  },
  pauseBridge: async () => {
    pauseCalls += 1;
    return { paused: true };
  },
  endBridge: async () => {
    endCalls += 1;
    return { ended: true };
  }
};
vm.runInNewContext(hardening, runtimeSandbox);
await runtimeSandbox.ensureTabListener(123);
assert.equal(injected.length, 1);
assert.equal(injected[0].target?.tabId, 123);
assert.equal(injected[0].files?.length, 1);
assert.equal(injected[0].files?.[0], "content-completion-guard.js");

guardStatusVersion = "1.16.2";
await assert.rejects(
  () => runtimeSandbox.ensureTabListener(123),
  /completion guard version 1\.16\.2 does not match required 1\.16\.3/
);
guardStatusVersion = "1.16.3";

await runtimeSandbox.pauseBridge("test pause");
assert.equal(pauseCalls, 1);
assert.equal(cancelMessages.length, 3);
assert.deepEqual(cancelMessages.map(item => item.tabId).sort((a, b) => a - b), [101, 102, 103]);
assert.ok(cancelMessages.every(item => item.reason === "bridge-paused"));
cancelMessages.length = 0;
await runtimeSandbox.endBridge("test stop");
assert.equal(endCalls, 1);
assert.equal(cancelMessages.length, 3);
assert.ok(cancelMessages.every(item => item.reason === "bridge-ended"));

await runtimeSandbox.sendToSide("A", "new prompt", {});
let result = await runtimeSandbox.handleCompletedResponse("A", "previous answer", {
  generationId: "gen-A-2",
  completedAt: 49_999
});
assert.equal(result.staleBaseline, true);
assert.equal(accepted.length, 0);

result = await runtimeSandbox.handleCompletedResponse("A", "previous answer", {
  generationId: "gen-A-2",
  completedAt: 50_001
});
assert.equal(result.ok, true);
assert.equal(accepted.length, 1);

// Content-guard integration exercises the async hold path using deterministic
// fake timers, avoiding slow wall-clock sleeps in the regression suite.
const listeners = [];
const outbound = [];
const timers = new Map();
let observerCallback = null;
let nextTimerId = 1;
let fakeNow = 100_000;
function makeNode(text) {
  const node = {
    innerText: text,
    textContent: text,
    getBoundingClientRect: () => ({ width: 100, height: 20 }),
    closest: () => node
  };
  return node;
}
function setIntervalFake(callback) {
  const id = nextTimerId++;
  timers.set(id, callback);
  return id;
}
function clearIntervalFake(id) {
  timers.delete(id);
}
async function tickOnlyTimer() {
  assert.equal(timers.size, 1, "exactly one held stale-response waiter expected");
  const callback = [...timers.values()][0];
  await callback();
}
class FakeMutationObserver {
  constructor(callback) { observerCallback = callback; }
  observe() {}
}
class FakeDate extends Date {
  static now() { return fakeNow; }
}

let currentNode = makeNode("identical answer");
const contentSandbox = {
  window: {},
  location: { hostname: "chatgpt.com" },
  Date: FakeDate,
  Map,
  Promise,
  Set,
  String,
  MutationObserver: FakeMutationObserver,
  setInterval: setIntervalFake,
  clearInterval: clearIntervalFake,
  document: {
    documentElement: {},
    querySelectorAll: () => [currentNode]
  },
  getComputedStyle: () => ({ visibility: "visible", display: "block" }),
  chrome: {
    runtime: {
      sendMessage: async msg => {
        outbound.push(msg);
        return { ok: true, accepted: true };
      },
      onMessage: { addListener: fn => listeners.push(fn) }
    }
  }
};
vm.runInNewContext(guard, contentSandbox);
assert.equal(listeners.length, 1);
assert.equal(typeof observerCallback, "function");

// 1) Unchanged old node/text is held rather than falsely acknowledged.
listeners[0]({ type: "AI_BRIDGE_SEND", generationId: "gen-1" }, {}, () => {});
const heldNewNode = contentSandbox.chrome.runtime.sendMessage({
  type: "AI_BRIDGE_RESPONSE",
  text: "identical answer",
  artifacts: [{ name: "old.bin", dataBase64: "c3RhbGU=" }],
  generationId: "gen-1",
  completedAt: 99_000
});
assert.equal(outbound.length, 0);
assert.equal(timers.size, 1);

// 2) A brand-new response node with identical text is valid. After the grace
// window the held call is forwarded with a fresh timestamp and no stale bytes.
currentNode = makeNode("identical answer");
await tickOnlyTimer();
fakeNow += 1_401;
await tickOnlyTimer();
result = await heldNewNode;
assert.equal(result.accepted, true);
assert.equal(outbound.length, 1);
assert.equal(outbound[0].text, "identical answer");
assert.equal(outbound[0].completedAt, fakeNow);
assert.equal(outbound[0].artifacts.length, 0);
assert.equal(timers.size, 0);

// 3) A provider may reuse the same response container. Mutation evidence makes
// a repeated final answer valid even when identity and final text match baseline.
listeners[0]({ type: "AI_BRIDGE_SEND", generationId: "gen-2" }, {}, () => {});
const heldReusedNode = contentSandbox.chrome.runtime.sendMessage({
  type: "AI_BRIDGE_RESPONSE",
  text: "identical answer",
  generationId: "gen-2",
  completedAt: fakeNow - 1
});
currentNode.innerText = "streaming intermediate text";
currentNode.textContent = "streaming intermediate text";
observerCallback();
currentNode.innerText = "identical answer";
currentNode.textContent = "identical answer";
await tickOnlyTimer();
fakeNow += 1_401;
await tickOnlyTimer();
result = await heldReusedNode;
assert.equal(result.accepted, true);
assert.equal(outbound.length, 2);
assert.equal(outbound[1].text, "identical answer");
assert.equal(outbound[1].artifacts.length, 0);

// 4) If the real response text differs, content.js sends its normal newer call.
// That call supersedes the held stale one; only the real text goes to background.
listeners[0]({ type: "AI_BRIDGE_SEND", generationId: "gen-3" }, {}, () => {});
const heldDifferent = contentSandbox.chrome.runtime.sendMessage({
  type: "AI_BRIDGE_RESPONSE",
  text: "identical answer",
  generationId: "gen-3",
  completedAt: fakeNow - 1
});
currentNode.innerText = "different real answer";
currentNode.textContent = "different real answer";
observerCallback();
const freshDifferent = contentSandbox.chrome.runtime.sendMessage({
  type: "AI_BRIDGE_RESPONSE",
  text: "different real answer",
  artifacts: [],
  generationId: "gen-3",
  completedAt: fakeNow + 10
});
const heldResult = await heldDifferent;
result = await freshDifferent;
assert.equal(heldResult.superseded, true);
assert.equal(result.accepted, true);
assert.equal(outbound.length, 3);
assert.equal(outbound[2].text, "different real answer");
assert.equal(timers.size, 0);

// 5) Pause/Stop cancellation resolves a held stale-response promise locally and
// never forwards it to the privileged service worker afterward.
currentNode = makeNode("identical answer");
listeners[0]({ type: "AI_BRIDGE_SEND", generationId: "gen-4" }, {}, () => {});
const heldCancelled = contentSandbox.chrome.runtime.sendMessage({
  type: "AI_BRIDGE_RESPONSE",
  text: "identical answer",
  generationId: "gen-4",
  completedAt: fakeNow - 1
});
assert.equal(timers.size, 1);
let cancelReply = null;
listeners[0](
  { type: "AI_BRIDGE_CANCEL_COMPLETION_HOLDS", reason: "bridge-paused" },
  {},
  value => { cancelReply = value; }
);
result = await heldCancelled;
assert.equal(result.cancelled, true);
assert.equal(result.reason, "bridge-paused");
assert.equal(cancelReply.ok, true);
assert.equal(cancelReply.cancelled, 1);
assert.equal(cancelReply.version, "1.16.3");
assert.equal(timers.size, 0);
assert.equal(outbound.length, 3);

console.log("v1.16.3 completion identity + stale-baseline regression ok");
