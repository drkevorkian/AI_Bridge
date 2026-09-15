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
assert.match(hardening, /Completion guard could not be established/);
assert.match(hardening, /completed < start/);
assert.match(hardening, /state\?\.lastResponseBySide/);
assert.match(hardening, /baseHandleCompletedResponse/);
assert.match(hardening, /staleBaseline: true/);
assert.match(guard, /sameNode && sameText && !baseline\.changed/);
assert.match(guard, /MutationObserver/);
assert.match(guard, /AI_BRIDGE_COMPLETION_GUARD_STATUS/);
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
  roundStartedAtBySide: { A: null }
};
const injected = [];
const runtimeSandbox = {
  console: { warn() {} },
  Date,
  Map,
  Number,
  String,
  state: runtimeState,
  appendLog() {},
  chrome: {
    scripting: { executeScript: async payload => { injected.push(payload); } },
    tabs: {
      sendMessage: async (_tabId, msg) => msg?.type === "AI_BRIDGE_COMPLETION_GUARD_STATUS"
        ? { ok: true, patched: true, version: "1.16.3" }
        : { ok: true }
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
  }
};
vm.runInNewContext(hardening, runtimeSandbox);
await runtimeSandbox.ensureTabListener(123);
assert.equal(injected.length, 1);
assert.equal(injected[0].target?.tabId, 123);
assert.equal(injected[0].files?.length, 1);
assert.equal(injected[0].files?.[0], "content-completion-guard.js");

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

const listeners = [];
const outbound = [];
let observerCallback = null;
function makeNode(text) {
  const node = {
    innerText: text,
    textContent: text,
    getBoundingClientRect: () => ({ width: 100, height: 20 }),
    closest: () => node
  };
  return node;
}
let currentNode = makeNode("identical answer");
class FakeMutationObserver {
  constructor(callback) { observerCallback = callback; }
  observe() {}
}
const contentSandbox = {
  window: {},
  location: { hostname: "chatgpt.com" },
  Date,
  Map,
  Promise,
  String,
  MutationObserver: FakeMutationObserver,
  document: {
    documentElement: {},
    querySelectorAll: () => [currentNode]
  },
  getComputedStyle: () => ({ visibility: "visible", display: "block" }),
  chrome: {
    runtime: {
      sendMessage: async msg => {
        outbound.push(msg);
        return { ok: true };
      },
      onMessage: { addListener: fn => listeners.push(fn) }
    }
  }
};
vm.runInNewContext(guard, contentSandbox);
assert.equal(listeners.length, 1);
assert.equal(typeof observerCallback, "function");

listeners[0]({ type: "AI_BRIDGE_SEND", generationId: "gen-1" }, {}, () => {});
result = await contentSandbox.chrome.runtime.sendMessage({
  type: "AI_BRIDGE_RESPONSE",
  text: "identical answer",
  generationId: "gen-1"
});
assert.equal(result.staleBaseline, true);
assert.equal(outbound.length, 0);

currentNode = makeNode("identical answer");
result = await contentSandbox.chrome.runtime.sendMessage({
  type: "AI_BRIDGE_RESPONSE",
  text: "identical answer",
  generationId: "gen-1"
});
assert.equal(result.ok, true);
assert.equal(outbound.length, 1);

listeners[0]({ type: "AI_BRIDGE_SEND", generationId: "gen-2" }, {}, () => {});
currentNode.innerText = "streaming intermediate text";
currentNode.textContent = "streaming intermediate text";
observerCallback();
currentNode.innerText = "identical answer";
currentNode.textContent = "identical answer";
result = await contentSandbox.chrome.runtime.sendMessage({
  type: "AI_BRIDGE_RESPONSE",
  text: "identical answer",
  generationId: "gen-2"
});
assert.equal(result.ok, true);
assert.equal(outbound.length, 2);

console.log("v1.16.3 completion identity + stale-baseline regression ok");
