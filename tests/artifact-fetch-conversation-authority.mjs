import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const authority = fs.readFileSync(path.join(root, "artifact-request-authority-prelude.js"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

assert.match(content, /pageUrl: location\.href/);
assert.match(content, /manualCapture: options\.manualCapture === true/);
assert.match(content, /captureArtifacts\(node, \{ manualCapture: true \}\)/);
assert.match(background, /aiBridgeAuthorizeArtifactRequest/);
assert.match(wrapper, /artifact-request-authority-prelude\.js/);
assert.match(wrapper, /automaticRequiresDispatchConversation !== true/);

const caps = {
  version: 1,
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

console.log("artifact-fetch-conversation-authority: automatic and manual authority modes ok");
