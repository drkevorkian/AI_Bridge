import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "agent-capabilities.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");
const coordinator = fs.readFileSync(path.join(root, "coordinator-dynamic-agents.js"), "utf8");
const health = fs.readFileSync(path.join(root, "provider-health-runtime.js"), "utf8");

assert.match(wrapper, /uniqueTabBindingNeverRelaxed !== true/);
assert.match(wrapper, /distinctThreadRequiredWhenSameFamily !== true/);
assert.match(wrapper, /serializeSameFamilySends !== true/);
assert.match(coordinator, /evaluateAgentBindings/);
assert.match(health, /DUPLICATE_TAB/);
assert.doesNotMatch(source, /duplicateProviderAgentsEnabled:\s*true/);

const context = vm.createContext({ URL, console });
context.globalThis = context;
vm.runInContext(source, context, { filename: "agent-capabilities.js" });
const caps = context.__AI_BRIDGE_AGENT_CAPABILITIES__;

assert.equal(caps.duplicateProviderAgentsEnabled, false);
assert.equal(caps.uniqueTabBinding, true);
assert.equal(caps.uniqueTabBindingNeverRelaxed, true);
assert.equal(caps.distinctThreadRequiredWhenSameFamily, true);
assert.equal(caps.serializeSameFamilySends, true);

const uniqueFamilies = caps.evaluateAgentBindings([
  { side: "A", tabId: 11, url: "https://chatgpt.com/" },
  { side: "B", tabId: 22, url: "https://grok.com/" },
  { side: "C", tabId: 33, url: "https://claude.ai/" }
]);
assert.equal(uniqueFamilies.ok, true);

const sharedTab = caps.evaluateAgentBindings([
  { side: "A", tabId: 11, url: "https://chatgpt.com/c/one" },
  { side: "D", tabId: 11, url: "https://chatgpt.com/c/one" }
]);
assert.equal(sharedTab.ok, false);
assert.equal(sharedTab.errors.some(error => error.code === "DUPLICATE_TAB"), true);

const sharedFamilyCurrent = caps.evaluateAgentBindings([
  { side: "A", tabId: 11, url: "https://chatgpt.com/c/one" },
  { side: "D", tabId: 44, url: "https://chatgpt.com/c/two" }
]);
assert.equal(sharedFamilyCurrent.ok, false, "current policy must reject two ChatGPT tabs");
assert.equal(sharedFamilyCurrent.errors.some(error => error.code === "DUPLICATE_PROVIDER"), true);

const viewpoint = caps.evaluateAgentBindings([
  { side: "A", tabId: 11, url: "https://chatgpt.com/c/one" },
  { side: "D", tabId: 44, url: "https://chatgpt.com/c/two" },
  { side: "B", tabId: 22, url: "https://grok.com/" }
], { duplicateProviderAgentsEnabled: true });
assert.equal(viewpoint.ok, true, "future viewpoint mode may share a provider family across distinct tabs");
assert.equal(viewpoint.allowDuplicateFamilies, true);

const viewpointSameTab = caps.evaluateAgentBindings([
  { side: "A", tabId: 11, url: "https://chatgpt.com/c/one" },
  { side: "D", tabId: 11, url: "https://chatgpt.com/c/two" }
], { duplicateProviderAgentsEnabled: true });
assert.equal(viewpointSameTab.ok, false, "viewpoint mode must never put two agents on one tab");
assert.equal(viewpointSameTab.errors.some(error => error.code === "DUPLICATE_TAB"), true);

const spoof = caps.evaluateAgentBindings([
  { side: "A", tabId: 11, url: "https://chatgpt.com.evil.example/" }
]);
assert.equal(spoof.ok, false);
assert.equal(spoof.errors.some(error => error.code === "UNSUPPORTED"), true);

const first = caps.conversationIdentity({
  side: "A",
  tabId: 11,
  url: "https://chatgpt.com/c/one?utm=1#fragment"
});
const second = caps.conversationIdentity({
  side: "D",
  tabId: 44,
  url: "https://chatgpt.com/c/two"
});
assert.equal(first.familyId, "chatgpt");
assert.equal(first.threadKey, "https://chatgpt.com/c/one");
assert.notEqual(first.threadKey, second.threadKey);
assert.notEqual(first.provenanceId, second.provenanceId);

const sameThread = caps.evaluateAgentBindings([
  { side: "A", tabId: 11, url: "https://chatgpt.com/c/one?x=1" },
  { side: "D", tabId: 44, url: "https://chatgpt.com/c/one#y" }
], { duplicateProviderAgentsEnabled: true });
assert.equal(sameThread.ok, false, "same ChatGPT thread in two tabs is not two viewpoints");
assert.equal(sameThread.errors.some(error => error.code === "DUPLICATE_THREAD"), true);

const plan = caps.sameFamilySendPlan([
  { side: "A", tabId: 11, url: "https://chatgpt.com/c/one" },
  { side: "D", tabId: 44, url: "https://chatgpt.com/c/two" },
  { side: "B", tabId: 22, url: "https://grok.com/" }
]);
assert.equal(plan.serializePerTab, true);
assert.equal(plan.serializeDuplicatedFamilies, true);
const chatgptQueue = plan.queues.find(item => item.familyId === "chatgpt");
const grokQueue = plan.queues.find(item => item.familyId === "grok");
assert.equal(chatgptQueue.serialize, true);
assert.equal(grokQueue.serialize, false);

console.log("multi-tab-viewpoint-security: ok");
