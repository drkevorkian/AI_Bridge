import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
const bg=fs.readFileSync(path.join(here,"../runtime_review/background.js"),"utf8");

for(const token of [
  "function reviewCanonicalRolloverFreshUrl",
  "ROLLOVER_FRESH_CHAT_URL_CONTEXT_MISMATCH",
  "await reviewVerifyDurableRolloverContext(tx, context, { requireContinuity:true });",
  "const targetUrl = reviewCanonicalRolloverFreshUrl(tx.provider);",
  "await chrome.tabs.update(tabId, {url:targetUrl,active:true});"
]) assert.ok(bg.includes(token),"missing "+token);

const freshStart=bg.indexOf("function freshChatUrlFor");
const canonicalFnStart=bg.indexOf("function reviewCanonicalRolloverFreshUrl");
const freshFn=bg.slice(freshStart,canonicalFnStart);
assert.ok(freshStart>=0&&canonicalFnStart>freshStart,"fresh-chat helper ordering missing");
assert.ok(freshFn.includes("const provider = reviewProviderFromUrl(url.href);"),"freshChatUrlFor must derive provider through the trusted provider parser");
assert.ok(freshFn.includes("return reviewCanonicalRolloverFreshUrl(provider);"),"freshChatUrlFor must reuse the canonical provider URL mapping");
assert.doesNotMatch(freshFn,/return\s+"https?:\/\//,"freshChatUrlFor must not maintain a duplicate literal URL table");
assert.equal((bg.match(/context\.freshChatUrl/g)||[]).length,1,"persisted freshChatUrl may only appear in the pre-navigation integrity check");

const phase=bg.indexOf("if (tx.phase === ROLLOVER_PHASE.CONTINUITY_PREPARED)");
const verify=bg.indexOf("reviewVerifyDurableRolloverContext(tx, context, { requireContinuity:true })",phase);
const revoke=bg.indexOf("const revoked = revokeAuthority(tx.oldAuthority)",phase);
assert.ok(phase>=0&&verify>phase&&revoke>verify,"CONTINUITY_PREPARED restart must verify durable context before revocation");

const open=bg.indexOf("if (tx.phase === ROLLOVER_PHASE.OPENING_NEW_CHAT)");
const canonical=bg.indexOf("const targetUrl = reviewCanonicalRolloverFreshUrl(tx.provider);",open);
const update=bg.indexOf("chrome.tabs.update(tabId, {url:targetUrl,active:true})",open);
assert.ok(open>=0&&canonical>open&&update>canonical,"fresh-chat navigation must derive from durable provider, not persisted context");
assert.ok(!bg.slice(open,update+100).includes("url:context.freshChatUrl"),"persisted context must not authorize navigation target");

console.log("round52-rollover-pre-navigation-integrity: PASS");
