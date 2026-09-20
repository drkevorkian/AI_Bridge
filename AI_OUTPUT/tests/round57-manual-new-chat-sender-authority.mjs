import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"..");
const bg=fs.readFileSync(path.join(root,"runtime_review","background.js"),"utf8");

const start=bg.indexOf('if (msg.type === "AI_BRIDGE_NEW_CHATS")');
const end=bg.indexOf('if (msg.type === "AI_BRIDGE_START")',start);
assert.ok(start>=0&&end>start,"AI_BRIDGE_NEW_CHATS handler missing");
const block=bg.slice(start,end);

assert.ok(block.includes('reviewTrustedExtensionPage(sender)'),"manual New Chat must require trusted extension-page authority");
assert.ok(block.includes('NEW_CHAT_CONTROL_UNTRUSTED_SENDER'),"manual New Chat must fail closed for untrusted senders");
assert.ok(block.indexOf('reviewTrustedExtensionPage(sender)')<block.indexOf('resetSelectedChats(msg, sides)'),
  "sender trust must be checked before any tab reset/navigation");

const trustStart=bg.indexOf('function reviewTrustedExtensionPage(sender)');
const trustEnd=bg.indexOf('async function reviewCaptureUpdateBindings',trustStart);
assert.ok(trustStart>=0&&trustEnd>trustStart,"trusted extension-page authority helper missing");
const trust=bg.slice(trustStart,trustEnd);

for(const token of [
  'sender?.id!==extensionId',
  'senderUrl.startsWith(extensionOrigin+"/")',
  'String(sender.origin)!==extensionOrigin',
  'Number(sender.frameId)!==0',
  'String(sender.documentLifecycle)!=="active"'
]) assert.ok(trust.includes(token),"trusted sender helper missing "+token);

assert.doesNotMatch(block,/sender\?\.tab\)\s*return false/,"tab-hosted Dashboard/Settings must remain trusted when origin is extension-local");
console.log("round57-manual-new-chat-sender-authority: PASS");
