import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
const bg=fs.readFileSync(path.join(here,"../runtime_review/background.js"),"utf8");
const manifest=JSON.parse(fs.readFileSync(path.join(here,"../runtime_review/manifest.json"),"utf8");

const start=bg.indexOf("async function waitForTabReady");
const end=bg.indexOf("function reviewRolloverTitle",start);
assert.ok(start>=0&&end>start);
const waiter=bg.slice(start,end);
assert.ok(waiter.includes("expectedUrl = null"));
assert.ok(waiter.includes("const expectedReady = !expected || committedUrl === expected;"));
assert.ok(waiter.includes("const redirectSettled = !expected || !pendingUrl;"));
assert.ok(waiter.includes("const verified = await chrome.tabs.get(id);"));
assert.ok(waiter.includes("(!expected || !verifiedPendingUrl)"));

const open=bg.indexOf("if (tx.phase === ROLLOVER_PHASE.OPENING_NEW_CHAT)");
const next=bg.indexOf("if (tx.phase === ROLLOVER_PHASE.AWAITING_NEW_IDENTITY)",open);
const block=bg.slice(open,next);
assert.ok(block.includes("const pendingAtCanonicalTarget = String(tab?.pendingUrl || \"\") === targetUrl;"));
assert.ok(block.includes("waitForTabReady(tabId, 20000, targetUrl)"));
assert.ok(block.indexOf("pendingAtCanonicalTarget")<block.indexOf("waitForTabReady(tabId, 20000, targetUrl)"));
assert.ok(block.includes('if (String(tab?.url || "") !== targetUrl) throw new Error("ROLLOVER_FRESH_CHAT_CANONICAL_URL_MISMATCH");'));
assert.equal(manifest.version_name,"1.19.1.19-AI-B");
console.log("round56-pending-navigation-commit-barrier: PASS");
