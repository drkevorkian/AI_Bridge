import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const review=path.join(here,"../runtime_review");
const dashboard=fs.readFileSync(path.join(review,"dashboard.js"),"utf8");
const background=fs.readFileSync(path.join(review,"background.js"),"utf8");

const summaryStart=dashboard.indexOf("function activeTabBindingSummary()");
const validateStart=dashboard.indexOf("function validateActiveTabs",summaryStart);
const relayStart=dashboard.indexOf("let manualRelaySource",validateStart);
assert.ok(summaryStart>=0&&validateStart>summaryStart&&relayStart>validateStart,"shared active-tab binding helpers missing");
const bindingHelpers=dashboard.slice(summaryStart,relayStart);

for(const token of [
  "tabsById.has(tabId)",
  "const duplicateTabIds = new Set(",
  "allOpen: bindings.every(binding => binding.open)",
  "allDistinct: duplicateTabIds.size === 0",
  "function manualFreshTabReady(side, summary = activeTabBindingSummary())",
  "!summary.duplicateTabIds.has(binding.tabId)",
  "function validateActiveTabs(summary = activeTabBindingSummary())"
]) assert.ok(bindingHelpers.includes(token),"binding helper contract missing "+token);

const freshStart=dashboard.indexOf("async function openFreshChats(rawSides)");
const freshEnd=dashboard.indexOf("async function clearHistory",freshStart);
assert.ok(freshStart>=0&&freshEnd>freshStart,"manual fresh-chat implementation missing");
const fresh=dashboard.slice(freshStart,freshEnd);
for(const token of [
  "const bindingSummary = activeTabBindingSummary();",
  "const unavailable = requested.filter(side => !manualFreshTabReady(side, bindingSummary));",
  "Each logical AI must use a different browser tab before opening a fresh chat.",
  'type: "AI_BRIDGE_NEW_CHATS"',
  "sides: requested,",
  "...selectedBindings()"
]) assert.ok(fresh.includes(token),"manual fresh-chat execution guard missing "+token);

const controlsStart=dashboard.indexOf("function updateControls(s)");
const controlsEnd=dashboard.indexOf("function runtimePhaseLabel",controlsStart);
assert.ok(controlsStart>=0&&controlsEnd>controlsStart,"control-state block missing");
const controls=dashboard.slice(controlsStart,controlsEnd);
for(const token of [
  "const bindingSummary = activeTabBindingSummary();",
  "const activeTabsValid = validateActiveTabs(bindingSummary) === null;",
  "const manualTabReady = manualFreshTabReady(side, bindingSummary);",
  '$(`newChat${side}`).disabled = !manualFreshAllowed || !manualTabReady;'
]) assert.ok(controls.includes(token),"manual fresh-chat control policy missing "+token);

const listener=background.indexOf("chrome.runtime.onMessage.addListener");
const gate=background.indexOf("reviewUiControlSenderAllowed(msg,sender)",listener);
const handler=background.indexOf('if (msg.type === "AI_BRIDGE_NEW_CHATS")',listener);
assert.ok(listener>=0&&gate>listener&&handler>gate,"trusted extension-page gate must precede manual fresh-chat handler");

const setStart=background.indexOf("const REVIEW_UI_CONTROL_TYPES=new Set(");
const setEnd=background.indexOf("]);",setStart);
assert.ok(setStart>=0&&setEnd>setStart,"privileged UI control set missing");
const setBlock=background.slice(setStart,setEnd);
assert.ok(setBlock.includes('"AI_BRIDGE_NEW_CHATS"'),"manual fresh-chat endpoint must remain privileged");

const handlerEnd=background.indexOf('if (msg.type === "AI_BRIDGE_START")',handler);
const handlerBlock=background.slice(handler,handlerEnd);
assert.ok(handlerBlock.includes("resetSelectedChats(msg, sides)"),"manual fresh-chat handler must use verified reset path");

console.log("round59-manual-fresh-chat-binding-consistency: PASS");
