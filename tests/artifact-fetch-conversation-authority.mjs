import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const authority = fs.readFileSync(path.join(root, "artifact-request-authority-prelude.js"), "utf8");
const mutex = fs.readFileSync(path.join(root, "coordinator-mutex-prelude.js"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

assert.match(content, /pageUrl: location\.href/);
assert.match(content, /manualCapture: options\.manualCapture === true/);
assert.match(content, /captureArtifacts\(node, \{ manualCapture: true \}\)/);
assert.match(background, /aiBridgeAuthorizeArtifactRequest/);
assert.match(wrapper, /artifact-request-authority-prelude\.js/);
assert.match(wrapper, /automaticRequiresDispatchConversation !== true/);
assert.match(wrapper, /manualCaptureBypassesArmedGeneration !== true/);
assert.match(mutex, /if \(message\.manualCapture === true\)/);
assert.match(mutex, /manualCaptureBypassesArmedGeneration:\s*true/);

const caps = {
  version: 1,
  supportedAgentSides: ["A", "B", "C", "D", "E"],
  conversationIdentity({ side, tabId, url }) {
    try {
      const parsed = new URL(String(url || ""));
      if (parsed.protocol !== "https:" || parsed.hostname !== "chatgpt.com") return null;
      const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
      const threadKey = `${parsed.protocol}//${parsed.hostname}${pathname}`;
      return {
        side,
        tabId,
        familyId: "chatgpt",
        threadKey,
        provenanceId: `chatgpt:tab:${tabId}:${threadKey}`
      };
    } catch (_) {
      return null;
    }
  }
};

const sandbox = {
  console,
  URL,
  String,
  Number,
  Object,
  Boolean,
  globalThis: null,
  __AI_BRIDGE_AGENT_CAPABILITIES__: caps
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(authority, sandbox, { filename: "artifact-request-authority-prelude.js" });

const contract = sandbox.__AI_BRIDGE_ARTIFACT_REQUEST_AUTHORITY_V1__;
assert.equal(contract.version, 1);
assert.equal(contract.automaticRequiresArmedGeneration, true);
assert.equal(contract.automaticRequiresDispatchConversation, true);
assert.equal(contract.manualCaptureAllowsProvenanceRefresh, true);

const state = {
  generationIdBySide: { A: "gen-a" },
  viewpointIdentityBySide: {
    A: {
      provenanceId: "chatgpt:tab:101:https://chatgpt.com/c/old",
      threadKey: "https://chatgpt.com/c/old",
      providerFamily: "chatgpt",
      boundTabId: 101
    }
  }
};

const ok = sandbox.aiBridgeAuthorizeArtifactRequest({
  bridgeState: state,
  side: "A",
  tabId: 101,
  message: {
    generationId: "gen-a",
    pageUrl: "https://chatgpt.com/c/old?x=1#y"
  }
});
assert.equal(ok.mode, "automatic");

assert.throws(() => sandbox.aiBridgeAuthorizeArtifactRequest({
  bridgeState: state,
  side: "A",
  tabId: 101,
  message: {
    generationId: "gen-a",
    pageUrl: "https://chatgpt.com/c/new"
  }
}), /conversation no longer matches/);

assert.throws(() => sandbox.aiBridgeAuthorizeArtifactRequest({
  bridgeState: state,
  side: "A",
  tabId: 101,
  message: {
    generationId: "stale",
    pageUrl: "https://chatgpt.com/c/old"
  }
}), /currently armed generation/);

const manual = sandbox.aiBridgeAuthorizeArtifactRequest({
  bridgeState: state,
  side: "A",
  tabId: 101,
  message: {
    generationId: "stale",
    pageUrl: "https://chatgpt.com/c/new",
    manualCapture: true
  }
});
assert.equal(manual.mode, "manual-capture");

assert.throws(() => sandbox.aiBridgeAuthorizeArtifactRequest({
  bridgeState: state,
  side: "A",
  tabId: 101,
  message: {
    pageUrl: "https://evil.example/c/new",
    manualCapture: true
  }
}), /trusted current provider conversation/);

const listeners = [];
const mutexSandbox = {
  console,
  URL,
  String,
  Number,
  Object,
  Boolean,
  state: {
    tabA: 101,
    generationIdBySide: { A: null }
  },
  __AI_BRIDGE_AGENT_CAPABILITIES__: caps,
  chrome: {
    runtime: {
      onMessage: {
        addListener(listener) {
          listeners.push(listener);
          return listener;
        }
      }
    },
    tabs: {
      onRemoved: { addListener() {} },
      onReplaced: { addListener() {} }
    }
  }
};
mutexSandbox.globalThis = mutexSandbox;
vm.createContext(mutexSandbox);
vm.runInContext(mutex, mutexSandbox, { filename: "coordinator-mutex-prelude.js" });
assert.equal(mutexSandbox.__AI_BRIDGE_COORDINATOR_MUTEX__.manualCaptureBypassesArmedGeneration, true);

mutexSandbox.chrome.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
  sendResponse({ ok: true, reachedListener: true });
  return false;
});
const gated = listeners[listeners.length - 1];

let automaticRejected = null;
gated({
  type: "AI_BRIDGE_FETCH_ARTIFACT",
  observed: true,
  url: "https://chatgpt.com/backend-api/file",
  name: "file.bin",
  mime: "application/octet-stream",
  generationId: "A-123456789-deadbeef",
  candidateSignature: "https://chatgpt.com/backend-api/file|file.bin",
  pageUrl: "https://chatgpt.com/c/new"
}, { tab: { id: 101 } }, value => { automaticRejected = value; });
assert.equal(automaticRejected?.rejectedBy, "artifact-provenance-gate");

let manualAllowed = null;
gated({
  type: "AI_BRIDGE_FETCH_ARTIFACT",
  observed: true,
  url: "https://chatgpt.com/backend-api/file",
  name: "file.bin",
  mime: "application/octet-stream",
  generationId: "stale",
  manualCapture: true,
  candidateSignature: "https://chatgpt.com/backend-api/file|file.bin",
  pageUrl: "https://chatgpt.com/c/new"
}, { tab: { id: 101 } }, value => { manualAllowed = value; });
assert.equal(manualAllowed?.reachedListener, true);

let missingPageRejected = null;
gated({
  type: "AI_BRIDGE_FETCH_ARTIFACT",
  observed: true,
  url: "https://chatgpt.com/backend-api/file",
  name: "file.bin",
  mime: "application/octet-stream",
  manualCapture: true,
  candidateSignature: "https://chatgpt.com/backend-api/file|file.bin"
}, { tab: { id: 101 } }, value => { missingPageRejected = value; });
assert.equal(missingPageRejected?.rejectedBy, "artifact-provenance-gate");

console.log("artifact-fetch-conversation-authority: automatic and manual authority modes ok");
