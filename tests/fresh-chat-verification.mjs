import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const content=fs.readFileSync(path.join(root,"content.js"),"utf8");
const background=fs.readFileSync(path.join(root,"background.js"),"utf8");

assert.match(content,/function conversationIdentity\(\)/);
assert.match(content,/function sameConversationIdentity\(a, b\)/);
assert.match(content,/verifiedFresh: true/);
assert.match(content,/fresh-chat-identity-not-verified/);
assert.match(content,/beforeIdentity/);
assert.match(content,/afterIdentity/);
assert.match(background,/clicked\?\.ok && clicked\.clicked && clicked\.verifiedFresh/);
assert.match(background,/A click without verified conversation-identity change is not accepted as/);
assert.match(background,/freshChatUrlFor/);
assert.match(background,/waitForTabReady/);

console.log("AI Bridge fresh-chat verification: OK");
