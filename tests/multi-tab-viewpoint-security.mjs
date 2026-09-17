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
assert.match(wrapper, /duplicateProviderAgentsEnabled !== true/);
assert.match(coordinator, /evaluateAgentBindings/);
assert.match(health, /DUPLICATE_TAB/);
assert.match(health, /DUPLICATE_THREAD/);

const context = vm.createContext({ URL, console });
context.globalThis = context;
vm.runInContext(source, context, { filename: "agent-capabilities.js" });
const caps = context.__AI_BRIDGE_AGENT_CAPABILITIES__;

assert.equal(caps.duplicateProviderAgentsEnabled, true);
assert.equal(caps.uniqueTabBinding, true);
assert.equal(caps.uniqueTabBindingNeverRelaxed, true);
assert.equal(caps.distinctThreadRequiredWhenSameFamily, true);
assert.equal(caps.serializeSameFamilySends, true);

const productionOptions = { duplicateProviderAgentsEnabled: caps.duplicateProviderAgentsEnabled };

const uniqueFamilies = caps.evaluateAgentBindings([
  { side: "A", tabId: 11, url: "https://chatgpt.com/" },
  { side: "B", tabId: 22, url: "https://grok.com/" },
  { side: "C", tabId: 33, url: "https://claude.ai/" }
], productionOptions);
assert.equal(uniqueFamilies.ok, true);

const sharedTab = caps.evaluateAgentBindings([
  { side: "A", tabId: 11, url: "https://chatgpt.com/c/one" },
  { side: "D", tabId: 11, url: "https://chatgpt.com/c/two" }
], productionOptions);
assert.equal(sharedTab.ok, false);
assert.equal(sharedTab.errors.some(error => error.code === "DUPLICATE_TAB"), true);

const sharedFamilyProduction = caps.evaluateAgentBindings([
  { side: "A", tabId: 11, url: "https://chatgpt.com/c/one" },
  { side: "D", tabId: 44, url: "https://chatgpt.com/c/two" }
], productionOptions);
assert.equal(sharedFamilyProduction.ok, true, "production viewpoint mode must allow distinct ChatGPT tabs and threads");
assert.equal(sharedFamilyProduction.allowDuplicateFamilies, true);

const explicitlyDisabled = caps.evaluateAgentBindings([
  { side: "A", tabId: 11, url: "https://chatgpt.com/c/one" },
  { side: "D", tabId: 44, url: "https://chatgpt.com/c/two" }
], { duplicateProviderAgentsEnabled: false });
assert.equal(explicitlyDisabled.ok, false, "the evaluator must retain the fail-closed policy option");
assert.equal(explicitlyDisabled.errors.some(error => error.code === "DUPLICATE_PROVIDER"), true);

const sameThread = caps.evaluateAgentBindings([
  { side: "A", tabId: 11, url: "https://chatgpt.com/c/one?x=1" },
  { side: "D", tabId: 44, url: "https://chatgpt.com/c/one#y" }
], productionOptions);
assert.equal(sameThread.ok, false, "same ChatGPT thread in two tabs is not two viewpoints");
assert.equal(sameThread.errors.some(error => error.code === "DUPLICATE_THREAD"), true);

const spoof = caps.evaluateAgentBindings([
  { side: "A", tabId: 11, url: "https://chatgpt.com.evil.example/" }
], productionOptions);
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
