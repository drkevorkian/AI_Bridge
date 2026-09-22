import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"..");
const content=fs.readFileSync(path.join(root,"runtime_review","content.js"),"utf8");
const bg=fs.readFileSync(path.join(root,"runtime_review","background.js"),"utf8");
const manifest=JSON.parse(fs.readFileSync(path.join(root,"runtime_review","manifest.json"),"utf8"));

assert.ok(content.includes('resident.build === CONTENT_BUILD'));
assert.ok(content.includes('"same-build-reinjection"'));
assert.ok(content.includes('resident.dispose('));
assert.doesNotMatch(
  content,
  /resident\.schema === CONTENT_RUNTIME_SCHEMA[\s\S]{0,220}resident\.build === CONTENT_BUILD[\s\S]{0,220}resident\.active === true[\s\S]{0,80}return;/,
  "same-build resident marker must not suppress explicit reinjection after extension context invalidation"
);

for(const token of [
  "function bestEffortRuntimeMessage(message)",
  "function extensionContextInvalidated(error)",
  "async function runtimeSendMessage(message)",
  '/extension context invalidated/i',
  'disposeContentRuntime("extension-context-invalidated")',
  "acknowledgement=await runtimeSendMessage(pending.envelope)",
  'runtimeSendMessage({type:"AI_BRIDGE_DOCUMENT_ROUTE_CHANGED"})',
  'const result=await runtimeSendMessage({\n          type:"AI_BRIDGE_DOCUMENT_REGISTER"',
  'await runtimeSendMessage({\n            type:"AI_BRIDGE_PROVIDER_EVENT"',
  'runtimeSendMessage({\n        type:"AI_BRIDGE_THREAD_LIMIT"'
]) assert.ok(content.includes(token),"invalidated-context response lifecycle missing "+token);

const directRuntimeCalls=[...content.matchAll(/chrome\.runtime\.sendMessage/g)];
assert.equal(
  directRuntimeCalls.length,
  2,
  "all operational content-to-worker messages must flow through invalidation-safe wrappers"
);

assert.match(bg,/^importScripts\("runtime-core\.js","update-checkpoint\.js"\);/);
assert.doesNotMatch(bg,/^importScripts\([^\n]*provider-limit-signatures\.js/m);
assert.ok(bg.includes("const AIBridgeProviderLimitSignatures = (() => {"));
assert.ok(bg.includes("classifyThreadLimit"));

const listenerStart=bg.indexOf("async function ensureTabListener(tabId)");
const listenerEnd=bg.indexOf("async function sendToSide",listenerStart);
assert.ok(listenerStart>=0&&listenerEnd>listenerStart,"ensureTabListener boundary missing");
const listener=bg.slice(listenerStart,listenerEnd);
assert.ok(listener.includes('existingPong = await chrome.tabs.sendMessage(tabId, { type: "AI_BRIDGE_PING" })'));
assert.ok(listener.includes('await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] })'));
assert.ok(listener.includes("pong?.ok && pong.version === CONTENT_VERSION"));

assert.equal(manifest.version_name,"1.19.1.39-AI-A");
console.log("round79-invalidated-content-runtime: PASS");
