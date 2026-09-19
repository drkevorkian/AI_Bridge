import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capsSrc = fs.readFileSync(path.join(root, "agent-capabilities.js"), "utf8");
const runtimeSrc = fs.readFileSync(path.join(root, "viewpoint-runtime.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

const context = vm.createContext({ URL, console, Object, Array, Number, String, Boolean, Set, Map, Promise, Error, RangeError });
context.globalThis = context;
vm.runInContext(capsSrc, context, { filename: "agent-capabilities.js" });
const caps = context.__AI_BRIDGE_AGENT_CAPABILITIES__;

assert.equal(caps.duplicateProviderAgentsEnabled, true);
assert.equal(caps.uniqueTabBindingNeverRelaxed, true);
assert.equal(caps.distinctThreadRequiredWhenSameFamily, true);
assert.equal(caps.serializeSameFamilySends, true);
assert.match(wrapper, /duplicateProviderAgentsEnabled !== true/);
assert.match(runtimeSrc, /enablesDuplicateProviders:\s*true/);
assert.match(runtimeSrc, /validatesBindingsBeforeSend:\s*true/);

const distinctViewpoints = caps.evaluateAgentBindings([
  { side: "A", tabId: 11, url: "https://chatgpt.com/c/design-a?utm=drop#frag" },
  { side: "D", tabId: 44, url: "https://chatgpt.com/c/design-b" },
  { side: "B", tabId: 22, url: "https://grok.com/chat/review" }
], { duplicateProviderAgentsEnabled: caps.duplicateProviderAgentsEnabled });
assert.equal(distinctViewpoints.ok, true, "distinct ChatGPT tabs and threads must be accepted");
assert.equal(distinctViewpoints.allowDuplicateFamilies, true);

const duplicateThread = caps.evaluateAgentBindings([
  { side: "A", tabId: 11, url: "https://chatgpt.com/c/shared?token=secret" },
  { side: "D", tabId: 44, url: "https://chatgpt.com/c/shared#different-fragment" }
], { duplicateProviderAgentsEnabled: caps.duplicateProviderAgentsEnabled });
assert.equal(duplicateThread.ok, false);
assert.equal(duplicateThread.errors.some(error => error.code === "DUPLICATE_THREAD"), true,
  "query/hash differences must not create fake viewpoints");

const duplicateTab = caps.evaluateAgentBindings([
  { side: "A", tabId: 11, url: "https://chatgpt.com/c/one" },
  { side: "D", tabId: 11, url: "https://chatgpt.com/c/two" }
], { duplicateProviderAgentsEnabled: caps.duplicateProviderAgentsEnabled });
assert.equal(duplicateTab.ok, false);
assert.equal(duplicateTab.errors.some(error => error.code === "DUPLICATE_TAB"), true,
  "one physical tab must never host two logical agents");

const spoof = caps.evaluateAgentBindings([
  { side: "A", tabId: 11, url: "https://chatgpt.com.evil.example/c/one" }
], { duplicateProviderAgentsEnabled: caps.duplicateProviderAgentsEnabled });
assert.equal(spoof.ok, false);
assert.equal(spoof.errors.some(error => error.code === "UNSUPPORTED"), true);

const plan = caps.sameFamilySendPlan([
  { side: "A", tabId: 11, url: "https://chatgpt.com/c/design-a" },
  { side: "D", tabId: 44, url: "https://chatgpt.com/c/design-b" },
  { side: "B", tabId: 22, url: "https://grok.com/chat/review" }
]);
assert.equal(plan.queues.find(row => row.familyId === "chatgpt")?.serialize, true);
assert.equal(plan.queues.find(row => row.familyId === "grok")?.serialize, false);

console.log("viewpoint-activation: ok");
