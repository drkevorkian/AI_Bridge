import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"..");
const bg=fs.readFileSync(path.join(root,"runtime_review","background.js"),"utf8");
const core=fs.readFileSync(path.join(root,"runtime_review","runtime-core.js"),"utf8");
const manifest=JSON.parse(fs.readFileSync(path.join(root,"runtime_review","manifest.json"),"utf8"));

assert.ok(bg.includes("async function reviewVerifiedFreshSurfaceRelayAllowed(side, authority, {"));
assert.ok(bg.includes("continuationSourceDispatchId = null"));
assert.ok(bg.includes("recoveryStart = false"));
assert.ok(bg.includes('state.currentSide!==normalizedSide'));
assert.ok(bg.includes('authority.identity?.kind!=="surface"'));
assert.ok(bg.includes('authority.identity?.provisional!==true'));
assert.ok(bg.includes('authority.identity?.writable!==true'));
assert.ok(bg.includes('String(tab?.pendingUrl||"")'));
assert.ok(bg.includes('String(tab?.url||"")!==canonical'));
assert.ok(bg.includes('source?.status===DISPATCH_STATUS.RESPONSE_COMMITTED'));
assert.ok(bg.includes('pending.kind==="SEQUENTIAL_SEND"'));
assert.ok(bg.includes('pending.targetSide===normalizedSide'));
assert.ok(bg.includes('"RECOVERY_START_PROCESSING"'));
assert.ok(bg.includes('"RECOVERY_START_CAUGHT_UP"'));
assert.ok(bg.includes('"RECOVERY_START_REPLAYING_FAILED_HANDOFF"'));

const sendStart=bg.indexOf("async function sendToSide");
const sendEnd=bg.indexOf("async function openDashboard",sendStart);
assert.ok(sendStart>=0&&sendEnd>sendStart,"sendToSide boundary missing");
const send=bg.slice(sendStart,sendEnd);
assert.ok(send.includes("allowRecoverySurface = false"));
assert.ok(send.includes("reviewVerifiedFreshSurfaceRelayAllowed(side, authority"));
assert.ok(send.includes("continuationSourceDispatchId,"));
assert.ok(send.includes("recoveryStart: Boolean(allowRecoverySurface)"));
assert.ok(send.includes("!confirmedConversation && !initialSurfaceBootstrap && !verifiedFreshSurfaceRelay"));
assert.ok(send.includes('purpose: initialSurfaceBootstrap ? "INITIAL" : "RELAY"'));
assert.doesNotMatch(send,/RECOVERY_RELAY/,"must not invent an unsupported dispatch purpose");

const handleStart=bg.indexOf("async function handleCompletedResponse");
const helperStart=bg.indexOf("async function reviewReadResponseToStartSource",handleStart);
assert.ok(handleStart>=0&&helperStart>handleStart,"handleCompletedResponse boundary missing");
const handle=bg.slice(handleStart,helperStart);
assert.ok(handle.includes("allowRecoverySurface = false"));
assert.ok(handle.includes("allowRecoverySurface });"),
  "direct recovered response processing must pass fresh-surface permission to sendToSide");

const recoveryStart=bg.indexOf('if (msg.type === "AI_BRIDGE_READ_RESPONSE_TO_START")');
const recoveryEnd=bg.indexOf('if (msg.type === "AI_BRIDGE_UPDATE_RULES")',recoveryStart);
assert.ok(recoveryStart>=0&&recoveryEnd>recoveryStart,"recovery handler boundary missing");
const recovery=bg.slice(recoveryStart,recoveryEnd);
assert.ok(recovery.includes("allowRecoverySurface:true"),
  "explicit replay path must opt into verified fresh-surface recovery");
assert.ok(recovery.includes("allowRecoverySurface:true"),
  "processed recovered response path must opt into verified fresh-surface recovery");

const continuationStart=bg.indexOf("async function reviewContinueAfterCommittedResponse");
const continuationEnd=bg.indexOf("function reviewResponseEnvelopeMatchesDispatch",continuationStart);
assert.ok(continuationStart>=0&&continuationEnd>continuationStart,"continuation boundary missing");
const continuation=bg.slice(continuationStart,continuationEnd);
assert.ok(continuation.includes("continuationSourceDispatchId: pending.sourceDispatchId"),
  "durable continuation must carry committed source dispatch proof");

assert.ok(
  core.includes('const PURPOSES=new Set(["INITIAL","RELAY","DIRECT","MANUAL","CONTINUITY","HUMAN_REPLY"])'),
  "dispatch purpose allowlist changed unexpectedly"
);
assert.equal(manifest.version_name,"1.19.1.38-AI-A");

console.log("round78-post-commit-fresh-target-dispatch: PASS");
