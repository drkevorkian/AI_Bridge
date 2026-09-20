import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
const bg=fs.readFileSync(path.join(here,"../runtime_review/background.js"),"utf8");
const manifest=JSON.parse(fs.readFileSync(path.join(here,"../runtime_review/manifest.json"),"utf8"));

const open=bg.indexOf("if (tx.phase === ROLLOVER_PHASE.OPENING_NEW_CHAT)");
assert.ok(open>=0,"OPENING_NEW_CHAT recovery block missing");
const next=bg.indexOf("if (tx.phase === ROLLOVER_PHASE.AWAITING_NEW_IDENTITY)",open);
assert.ok(next>open,"AWAITING_NEW_IDENTITY boundary missing");
const block=bg.slice(open,next);

for(const token of [
  "const targetUrl = reviewCanonicalRolloverFreshUrl(tx.provider);",
  'const atCanonicalTarget = String(tab?.url || "") === targetUrl;',
  "if (!atCanonicalTarget) {",
  "await chrome.tabs.update(tabId, {url:targetUrl,active:true});",
  'if (String(tab?.url || "") !== targetUrl) throw new Error("ROLLOVER_FRESH_CHAT_CANONICAL_URL_MISMATCH");'
]) assert.ok(block.includes(token),"OPENING_NEW_CHAT missing "+token);

assert.ok(
  block.indexOf("if (!atCanonicalTarget)") < block.indexOf("chrome.tabs.update"),
  "navigation must be guarded by canonical-target idempotency check"
);
assert.ok(
  block.indexOf("waitForTabReady(tabId)") > block.indexOf("if (!atCanonicalTarget)"),
  "recovery must wait for an already-started canonical navigation"
);
assert.equal((block.match(/chrome\.tabs\.update\(/g)||[]).length,1,"OPENING_NEW_CHAT must have one guarded update site");
assert.equal(manifest.version_name,"1.19.1.17-AI-B");
console.log("round54-rollover-navigation-idempotency: PASS");
