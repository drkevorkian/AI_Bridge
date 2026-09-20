import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"..");
const bg=fs.readFileSync(path.join(root,"runtime_review","background.js"),"utf8");

const setStart=bg.indexOf("const REVIEW_UI_CONTROL_TYPES=new Set(");
const helperStart=bg.indexOf("function reviewUiControlSenderAllowed",setStart);
assert.ok(setStart>=0&&helperStart>setStart,"UI control trust set missing");
const setBlock=bg.slice(setStart,helperStart);
assert.ok(setBlock.includes('"AI_BRIDGE_NEW_CHATS"'),"manual New Chat must be a privileged UI control");

const listener=bg.indexOf("chrome.runtime.onMessage.addListener");
const gate=bg.indexOf("reviewUiControlSenderAllowed(msg,sender)",listener);
const handler=bg.indexOf('if (msg.type === "AI_BRIDGE_NEW_CHATS")',listener);
assert.ok(listener>=0&&gate>listener&&handler>gate,"trusted UI sender gate must run before manual New Chat handler");
assert.ok(bg.includes('reason:"UI_CONTROL_UNTRUSTED_SENDER"'),"manual New Chat must fail closed through the UI control gate");

const handlerEnd=bg.indexOf('if (msg.type === "AI_BRIDGE_START")',handler);
assert.ok(handlerEnd>handler,"manual New Chat handler boundary missing");
const block=bg.slice(handler,handlerEnd);
assert.ok(block.includes("resetSelectedChats(msg, sides)"),"manual New Chat must use the trusted reset path");

const trustStart=bg.indexOf("function reviewTrustedExtensionPage(sender)");
const trustEnd=bg.indexOf("const REVIEW_UI_CONTROL_TYPES",trustStart);
assert.ok(trustStart>=0&&trustEnd>trustStart,"trusted extension-page authority helper missing");
const trust=bg.slice(trustStart,trustEnd);
for(const token of [
  'sender?.id!==extensionId',
  'senderUrl.startsWith(extensionOrigin+"/")',
  'String(sender.origin)!==extensionOrigin',
  'Number(sender.frameId)!==0',
  'String(sender.documentLifecycle)!=="active"'
]) assert.ok(trust.includes(token),"trusted sender helper missing "+token);

assert.doesNotMatch(trust,/sender\?\.tab\)\s*return false/,"tab-hosted Dashboard/Settings must remain trusted when origin is extension-local");

console.log("round57-manual-new-chat-sender-authority: PASS");
