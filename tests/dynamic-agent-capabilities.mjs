import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const source = fs.readFileSync(path.join(root, "agent-capabilities.js"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");

assert.ok(
  wrapper.includes('importScripts("agent-capabilities.js")'),
  "service worker should load the shared dynamic-agent capability contract"
);
assert.ok(
  wrapper.indexOf('importScripts("agent-capabilities.js")') < wrapper.indexOf('importScripts("background.js")'),
  "agent capability contract must load before the coordinator core"
);

const context = vm.createContext({ URL, console });
context.globalThis = context;
vm.runInContext(source, context, { filename: "agent-capabilities.js" });

const caps = context.__AI_BRIDGE_AGENT_CAPABILITIES__;
assert.ok(caps, "capability contract should initialize");
assert.equal(caps.version, 1);
assert.equal(caps.defaultAgentCount, 3);
assert.equal(caps.maxUniqueProviderAgents, 5);
assert.deepEqual(Array.from(caps.supportedAgentSides), ["A", "B", "C", "D", "E"]);
assert.deepEqual(Array.from(caps.providerFamilies, provider => provider.id), [
  "chatgpt",
  "grok",
  "claude",
  "gemini",
  "copilot"
]);
assert.equal(caps.duplicateProviderAgentsEnabled, false);
assert.equal(caps.uniqueTabBindingNeverRelaxed, true);
assert.equal(typeof caps.evaluateAgentBindings, "function");

assert.equal(caps.parseAgentCount(1), 1);
assert.equal(caps.parseAgentCount("5"), 5);
assert.equal(caps.parseAgentCount(0), null);
assert.equal(caps.parseAgentCount(6), null);
assert.equal(caps.parseAgentCount(2.5), null);
assert.equal(caps.parseAgentCount("abc"), null);
assert.equal(caps.normalizeAgentCount(4), 4);
assert.equal(caps.normalizeAgentCount(99), 3);
assert.equal(caps.normalizeAgentCount(99, 5), 5);
assert.deepEqual(Array.from(caps.sideIdsForCount(1)), ["A"]);
assert.deepEqual(Array.from(caps.sideIdsForCount(5)), ["A", "B", "C", "D", "E"]);
assert.throws(
  () => caps.sideIdsForCount(6),
  error => error?.name === "RangeError" && /1 to 5/.test(String(error?.message || "")),
  "sideIdsForCount should reject counts outside the supported provider-family limit"
);

assert.equal(caps.providerFamilyForUrl("https://chatgpt.com/")?.id, "chatgpt");
assert.equal(caps.providerFamilyForUrl("https://chat.openai.com/c/123")?.id, "chatgpt");
assert.equal(caps.providerFamilyForUrl("https://grok.com/")?.id, "grok");
assert.equal(caps.providerFamilyForUrl("https://claude.ai/new")?.id, "claude");
assert.equal(caps.providerFamilyForUrl("https://gemini.google.com/app")?.id, "gemini");
assert.equal(caps.providerFamilyForUrl("https://copilot.microsoft.com/")?.id, "copilot");
assert.equal(caps.providerFamilyForUrl("http://chatgpt.com/"), null, "HTTP must fail closed");
assert.equal(caps.providerFamilyForUrl("https://chatgpt.com.evil.example/"), null, "suffix spoof must fail closed");
assert.equal(caps.providerFamilyForUrl("not a url"), null);
assert.equal(caps.isSupportedProviderUrl("https://claude.ai/"), true);
assert.equal(caps.isSupportedProviderUrl("https://example.com/"), false);

console.log("dynamic-agent-capabilities: ok");
