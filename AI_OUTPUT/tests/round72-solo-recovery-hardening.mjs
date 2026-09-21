import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const bg=fs.readFileSync(path.join(here,"../runtime_review/background.js"),"utf8");
const content=fs.readFileSync(path.join(here,"../runtime_review/content.js"),"utf8");

for(const token of [
  "function reviewDispatchMatchesAuthority(record, authority)",
  "Number(record.tabId) !== Number(authority.tabId)",
  "Number(record.generationEpoch) !== Number(authority.generationEpoch)",
  "reviewSameIdentity(record.conversationIdentity, authority.identity)",
  'from?.kind === "surface"',
  'to?.kind === "conversation"',
  "if (authority && !reviewDispatchMatchesAuthority(r, authority)) return false;",
  "continuationCreatedAt: continuationPending?.createdAt || 0,\n    authority"
]) assert.ok(bg.includes(token),"authority-scoped replay guard missing "+token);

const sendStart=bg.indexOf("async function sendToSide");
const sendEnd=bg.indexOf("\nasync function openDashboard",sendStart);
assert.ok(sendStart>=0&&sendEnd>sendStart,"sendToSide boundary missing");
const send=bg.slice(sendStart,sendEnd);
assert.ok(send.includes("const proof = await reviewReadContentActionProof(dispatch);"));
assert.ok(send.includes('evidence: "content-action-proof-after-ack-loss"'));
assert.ok(send.includes('failureReason: "MESSAGE_ACK_LOST"'));
assert.ok(send.indexOf("const proof = await reviewReadContentActionProof(dispatch);") < send.indexOf('failureReason: "MESSAGE_ACK_LOST"'));

assert.ok(content.includes('composer: Object.freeze(["#prompt-textarea"])'));
assert.ok(content.includes("button[data-testid='send-button']"));
assert.ok(content.includes("button#composer-submit-button"));
assert.ok(content.includes("const composer1=await waitForTrusted(config.composer,{attempts:80,delayMs:100});"));
assert.ok(content.includes("for(let i=0;i<80;i++){\n      await sleep(i===0?120:100);"));
assert.ok(!content.includes("button[type='submit']"));
assert.ok(!content.includes('button[type="submit"]'));
assert.ok(!content.includes("new KeyboardEvent"));

console.log("round72-solo-recovery-hardening: PASS");
