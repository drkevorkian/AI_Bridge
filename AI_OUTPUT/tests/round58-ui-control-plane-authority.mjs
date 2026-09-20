import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"..");
const bg=fs.readFileSync(path.join(root,"runtime_review","background.js"),"utf8");

const expected=[
  "AI_BRIDGE_POWER_SET",
  "AI_BRIDGE_AUTO_UPDATE_SET",
  "AI_BRIDGE_SETTINGS_OPEN",
  "AI_BRIDGE_PROVIDER_HEALTH",
  "AI_BRIDGE_GET_STATE",
  "AI_BRIDGE_OPEN_DASHBOARD",
  "AI_BRIDGE_DOWNLOAD_ARTIFACT",
  "AI_BRIDGE_CLEAR_ARTIFACTS",
  "AI_BRIDGE_CLEAR_HISTORY",
  "AI_BRIDGE_NEW_CHATS",
  "AI_BRIDGE_START",
  "AI_BRIDGE_UPDATE_RULES",
  "AI_BRIDGE_MANUAL_RELAY",
  "AI_BRIDGE_PAUSE",
  "AI_BRIDGE_RESUME",
  "AI_BRIDGE_STOP",
  "AI_BRIDGE_RESEND",
  "AI_BRIDGE_HUMAN_REPLY",
  "AI_BRIDGE_HUMAN_SUPPRESS",
  "AI_BRIDGE_HUMAN_REOPEN",
  "AI_BRIDGE_INTERJECT"
];
const setStart=bg.indexOf("const REVIEW_UI_CONTROL_TYPES=new Set(");
const helperStart=bg.indexOf("function reviewUiControlSenderAllowed",setStart);
assert.ok(setStart>=0&&helperStart>setStart,"UI control type allowlist missing");
const setBlock=bg.slice(setStart,helperStart);
for(const type of expected) assert.ok(setBlock.includes('"'+type+'"'),"UI control trust set missing "+type);

const listener=bg.indexOf("chrome.runtime.onMessage.addListener");
const firstHandler=bg.indexOf('if (msg.type === "AI_BRIDGE_POWER_SET")',listener);
const gate=bg.indexOf("reviewUiControlSenderAllowed(msg,sender)",listener);
assert.ok(listener>=0&&gate>listener&&gate<firstHandler,"UI sender authority must run before privileged handlers");
assert.ok(bg.includes('UI_CONTROL_UNTRUSTED_SENDER'));

const trustStart=bg.indexOf("function reviewTrustedExtensionPage(sender)");
const trustEnd=bg.indexOf("const REVIEW_UI_CONTROL_TYPES",trustStart);
const trust=bg.slice(trustStart,trustEnd);
for(const token of [
  'sender?.id!==extensionId',
  'senderUrl.startsWith(extensionOrigin+"/")',
  'String(sender.origin)!==extensionOrigin',
  'Number(sender.frameId)!==0',
  'String(sender.documentLifecycle)!=="active"'
]) assert.ok(trust.includes(token),"trusted extension sender helper missing "+token);

// Provider/content control-plane messages must remain outside the UI set.
const providerTypes=[
  "AI_BRIDGE_DOCUMENT_REGISTER","AI_BRIDGE_DOCUMENT_ROUTE_CHANGED","AI_BRIDGE_PROVIDER_EVENT",
  "AI_BRIDGE_THREAD_LIMIT","AI_BRIDGE_RESPONSE","AI_BRIDGE_FETCH_ARTIFACT"
];
for(const type of providerTypes) assert.ok(!setBlock.includes('"'+type+'"'),"provider/content message accidentally requires extension-page sender: "+type);

// Update transaction controls intentionally keep their own explicit trusted
// extension-page checks because they form a separate atomic-update boundary.
const updateTypes=[
  "AI_BRIDGE_UPDATE_PREPARE","AI_BRIDGE_UPDATE_APPLIED",
  "AI_BRIDGE_UPDATE_CANCEL","AI_BRIDGE_UPDATE_STATUS"
];
for(const type of updateTypes){
  const handler=bg.indexOf('if (msg.type === "'+type+'")',listener);
  assert.ok(handler>listener,"update control handler missing "+type);
  const nextHandler=bg.indexOf('if (msg.type === "',handler+1);
  const block=bg.slice(handler,nextHandler>handler?nextHandler:handler+1200);
  assert.ok(block.includes("reviewTrustedExtensionPage(sender)"),"update control lacks explicit sender trust: "+type);
}

// Exhaustive message-surface guard: adding a new handler must require a
// deliberate classification instead of silently inheriting permissive default.
const handlerTypes=[...new Set([...bg.matchAll(/msg\.type\s*===\s*"([^"]+)"/g)].map(match=>match[1]))];
const classified=new Set([...expected,...providerTypes,...updateTypes]);
const unclassified=handlerTypes.filter(type=>!classified.has(type));
assert.deepEqual(unclassified,[],"runtime message handlers missing trust classification: "+unclassified.join(", "));

console.log("round58-ui-control-plane-authority: PASS");
