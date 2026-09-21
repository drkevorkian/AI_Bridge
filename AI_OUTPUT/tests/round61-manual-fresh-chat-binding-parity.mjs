import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"..");
const dashboard=fs.readFileSync(path.join(root,"runtime_review","dashboard.js"),"utf8");
const background=fs.readFileSync(path.join(root,"runtime_review","background.js"),"utf8");

const helperStart=dashboard.indexOf("function activeBindingStatus()");
const validateStart=dashboard.indexOf("function validateActiveTabs()",helperStart);
assert.ok(helperStart>=0&&validateStart>helperStart,"Dashboard shared active-binding helper missing");
const helper=dashboard.slice(helperStart,validateStart);

for(const token of [
  "const bindings = SIDES.map(side => ({ side, tabId: selectedTab(side) }));",
  "const missingSides = bindings",
  "const ownersByTab = new Map();",
  "const duplicateTabs = new Set(",
  "const duplicateSides = new Set(",
  "valid: missingSides.length === 0 && duplicateTabs.size === 0"
]) assert.ok(helper.includes(token),"Dashboard active-binding helper missing "+token);

const validateEnd=dashboard.indexOf("let manualRelaySource",validateStart);
const validate=dashboard.slice(validateStart,validateEnd);
assert.ok(validate.includes("const status = activeBindingStatus();"),"validateActiveTabs must consume shared binding status");
assert.ok(validate.includes("status.missingSides.length"),"missing active tabs must fail validation");
assert.ok(validate.includes("status.duplicateTabs.size"),"duplicate active tabs must fail validation");
assert.ok(validate.includes("Each logical AI must use a different browser tab."),"Dashboard duplicate-binding message missing");

const openStart=dashboard.indexOf("async function openFreshChats(rawSides)");
const openEnd=dashboard.indexOf("async function clearHistory",openStart);
assert.ok(openStart>=0&&openEnd>openStart,"manual fresh-chat UI path missing");
const open=dashboard.slice(openStart,openEnd);
assert.ok(open.includes("const bindingError = validateActiveTabs();"),"manual New Chat must revalidate the full active roster before messaging backend");
assert.ok(
  open.indexOf("const bindingError = validateActiveTabs();") <
  open.indexOf('type: "AI_BRIDGE_NEW_CHATS"'),
  "Dashboard full-roster validation must precede manual New Chat request"
);

const controlsStart=dashboard.indexOf("function updateControls(s)");
const controlsEnd=dashboard.indexOf("function runtimePhaseLabel",controlsStart);
assert.ok(controlsStart>=0&&controlsEnd>controlsStart,"Dashboard controls block missing");
const controls=dashboard.slice(controlsStart,controlsEnd);
for(const token of [
  "const bindingStatus = activeBindingStatus();",
  "const activeTabsValid = bindingStatus.valid;",
  '$("newAllChats").disabled = !manualFreshAllowed || !activeTabsValid;',
  '$("freshOnStart").disabled = !manualFreshAllowed || !activeTabsValid;',
  '$(`newChat${side}`).disabled = !manualFreshAllowed || !bindingStatus.valid;'
]) assert.ok(controls.includes(token),"Dashboard control parity missing "+token);
assert.doesNotMatch(controls,/manualTabReady/,"individual New Chat must not bypass the shared full-roster binding policy");

const backendHelperStart=background.indexOf("function reviewValidateManualFreshBindings");
const backendResetStart=background.indexOf("async function resetSelectedChats",backendHelperStart);
assert.ok(backendHelperStart>=0&&backendResetStart>backendHelperStart,"backend full-roster binding guard missing");
const backendHelper=background.slice(backendHelperStart,backendResetStart);
assert.ok(backendHelper.includes("owners.length>1"),"backend must reject duplicate tab ownership");
assert.ok(backendHelper.includes("Each logical AI must use a different browser tab."),"backend duplicate-binding message missing");

const backendResetEnd=background.indexOf("function normalizeProviderEventText",backendResetStart);
const backendReset=background.slice(backendResetStart,backendResetEnd);
const backendValidate=backendReset.indexOf("reviewValidateManualFreshBindings(msg,SIDES)");
assert.ok(backendValidate>=0,"manual backend reset must validate the full active roster");
assert.ok(backendValidate<backendReset.indexOf("chrome.tabs.get"),"backend binding validation must precede provider tab lookup");
assert.ok(backendValidate<backendReset.indexOf("resetChatTab"),"backend binding validation must precede provider mutation");

console.log("round61-manual-fresh-chat-binding-parity: PASS");
