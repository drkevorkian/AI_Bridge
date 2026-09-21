import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"..");
const bg=fs.readFileSync(path.join(root,"runtime_review","background.js"),"utf8");

for(const token of [
  "function reviewValidateManualFreshBindings",
  "const rosterBindings=reviewValidateManualFreshBindings(msg,SIDES)",
  "Each logical AI must use a different browser tab.",
  "Manual fresh-chat navigation mutates a real provider tab"
]) assert.ok(bg.includes(token),"background missing "+token);

const helperStart=bg.indexOf("function reviewValidateManualFreshBindings");
const resetStart=bg.indexOf("async function resetSelectedChats",helperStart);
assert.ok(helperStart>=0&&resetStart>helperStart);
const helper=bg.slice(helperStart,resetStart);
assert.ok(helper.includes("owners.length>1"),"full-roster duplicate ownership must be rejected");
assert.ok(helper.includes("tabId:Number(msg?.[\`tab\${side}\`])"),"helper must use supplied active binding map");

const resetEnd=bg.indexOf("function normalizeProviderEventText",resetStart);
const reset=bg.slice(resetStart,resetEnd);
assert.ok(
  reset.indexOf("reviewValidateManualFreshBindings(msg,SIDES)") <
  reset.indexOf("chrome.tabs.get"),
  "duplicate binding validation must happen before any provider tab lookup/navigation"
);
assert.ok(
  reset.indexOf("reviewValidateManualFreshBindings(msg,SIDES)") <
  reset.indexOf("resetChatTab"),
  "duplicate binding validation must happen before any fresh-chat mutation"
);
assert.doesNotMatch(reset,/const ids = chosen\.map\(side => Number\(msg\?\.\[\`tab\$\{side\}\`\]\)\);/);

console.log("round60-manual-fresh-chat-full-roster-bindings: PASS");
