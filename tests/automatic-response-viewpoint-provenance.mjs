import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prelude = fs.readFileSync(path.join(root, "content-runtime-prelude.js"), "utf8");
const generation = fs.readFileSync(path.join(root, "coordinator-generation-hardening.js"), "utf8");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

assert.match(prelude, /pageUrl: location\.href/);
assert.match(prelude, /automaticResponseIncludesPageUrl: true/);
assert.match(background, /pageUrl: responsePageUrl/);
assert.match(wrapper, /version !== 5/);
assert.match(wrapper, /requiresAutomaticResponsePageIdentity !== true/);
assert.match(wrapper, /rejectsCrossThreadSpaResponseBeforeConsumption !== true/);

const persisted = [];
const committed = [];
const state = {
  tabA: 101,
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

const caps = {
  version: 1,
  conversationIdentity({ side, tabId, url }) {
    try {
      const parsed = new URL(String(url || ""));
      if (parsed.protocol !== "https:" || parsed.hostname !== "chatgpt.com") return null;
      const pathName = parsed.pathname.replace(/\/+$/, "") || "/";
      const threadKey = `${parsed.protocol}//${parsed.hostname}${pathName}`;
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
  Date,
  Promise,
  URL,
  String,
  Number,
  Object,
  Array,
  Boolean,
  globalThis: null,
  state,
  __AI_BRIDGE_AGENT_CAPABILITIES__: caps,
  tabForSide(side) { return state[`tab${side}`]; },
  generationMatches(expected, incoming) {
    const a = String(expected || "");
    const b = String(incoming || "");
    return Boolean(a && b && a === b);
  },
  async saveState() { persisted.push(JSON.parse(JSON.stringify(state))); },
  async handleCompletedResponse(side, text, options) {
    committed.push({ side, text, options });
    return { ok: true };
  },
  async sendToSide() { return { ok: true }; },
  appendLog() {},
  chrome: {}
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(generation, sandbox, { filename: "coordinator-generation-hardening.js" });

const contract = sandbox.__AI_BRIDGE_GENERATION_SECURITY__;
assert.equal(contract.version, 5);
assert.equal(contract.requiresAutomaticResponsePageIdentity, true);
assert.equal(contract.rejectsCrossThreadSpaResponseBeforeConsumption, true);

const wrong = await sandbox.handleCompletedResponse("A", "wrong thread", {
  generationId: "gen-a",
  pageUrl: "https://chatgpt.com/c/new"
});
assert.equal(wrong.staleConversation, true);
assert.equal(state.generationIdBySide.A, "gen-a", "wrong-thread response must not consume generation");
assert.equal(persisted.length, 0);
assert.equal(committed.length, 0);

const samePathDifferentQuery = await sandbox.handleCompletedResponse("A", "right thread", {
  generationId: "gen-a",
  pageUrl: "https://chatgpt.com/c/old?utm=test#section"
});
assert.equal(samePathDifferentQuery.ok, true);
assert.equal(state.generationIdBySide.A, null);
assert.equal(persisted.length, 1, "accepted generation must still durably consume before commit");
assert.equal(committed.length, 1);

state.generationIdBySide.A = "gen-b";
state.viewpointIdentityBySide.A = {
  provenanceId: "chatgpt:tab:101:https://chatgpt.com/c/old",
  threadKey: "https://chatgpt.com/c/old",
  providerFamily: "chatgpt",
  boundTabId: 101
};
const missing = await sandbox.handleCompletedResponse("A", "missing page identity", {
  generationId: "gen-b",
  pageUrl: ""
});
assert.equal(missing.staleConversation, true);
assert.equal(state.generationIdBySide.A, "gen-b");

console.log("automatic-response-viewpoint-provenance: SPA thread identity enforced before generation consumption");
