import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const review = path.join(here, "../runtime_review");
const background = fs.readFileSync(path.join(review, "background.js"), "utf8");
const contentScript = fs.readFileSync(path.join(review, "content.js"), "utf8");
const signatures = fs.readFileSync(path.join(review, "provider-limit-signatures.js"), "utf8");

assert.doesNotThrow(() => new Function(background), "background.js must parse");
assert.doesNotThrow(() => new Function(contentScript), "content.js must parse");
assert.doesNotThrow(() => new Function(signatures), "provider-limit-signatures.js must parse");

assert.match(background, /importScripts\("runtime-core\.js","update-checkpoint\.js"\)/);
assert.match(background, /const AIBridgeProviderLimitSignatures = \(\(\) => \{/);
assert.doesNotMatch(background, /importScripts\([^\n]*provider-limit-signatures\.js/);
assert.match(background, /function reviewAuthorizeThreadLimit\(/);
assert.match(background, /THREAD_LIMIT_NO_ACTIVE_DISPATCH/);
assert.match(background, /THREAD_LIMIT_DOCUMENT_MISMATCH/);
assert.match(background, /THREAD_LIMIT_AUTHORITY_TOKEN_MISMATCH/);
assert.match(background, /THREAD_LIMIT_GENERATION_MISMATCH/);
assert.match(background, /THREAD_LIMIT_IDENTITY_MISMATCH/);
assert.match(background, /AIBridgeProviderLimitSignatures\.classifyThreadLimit\(observation\)/);

assert.match(background, /reviewLatestCommittedDispatchBefore/);
assert.match(background, /markFinalResponseCommitted/);
assert.match(background, /prepareContinuity/);
assert.match(background, /HARD_THREAD_LIMIT_REJECTED_BY_PROVIDER/);
assert.match(background, /ROLLOVER_PHASE\.OLD_AUTHORITY_REVOKED/);

const resumeStart = background.indexOf("async function reviewResumeThreadRollover");
const resumeEnd = background.indexOf("async function reviewHandleThreadLimit", resumeStart);
assert.ok(resumeStart >= 0 && resumeEnd > resumeStart, "rollover resume function missing");
const resume = background.slice(resumeStart, resumeEnd);

const finalIndex = resume.indexOf("markFinalResponseCommitted");
const continuityIndex = resume.indexOf("prepareContinuity");
const revokeIndex = resume.indexOf("ROLLOVER_PHASE.OLD_AUTHORITY_REVOKED");
const openingIndex = resume.indexOf("ROLLOVER_PHASE.OPENING_NEW_CHAT");
assert.ok(finalIndex >= 0 && continuityIndex > finalIndex, "continuity must follow final-response commit");
assert.ok(revokeIndex > continuityIndex, "old authority must be revoked only after continuity preparation");
assert.ok(openingIndex > revokeIndex, "new-chat opening must follow authority revocation");

assert.match(background, /purpose:\s*"CONTINUITY"/);
assert.match(background, /rolloverId:tx\.rolloverId/);
assert.match(background, /ROLLOVER_PHASE\.AWAITING_CONTINUITY_RESPONSE/);
assert.match(background, /dispatch\.purpose === "CONTINUITY"/);
assert.match(background, /ROLLOVER_PHASE\.COMPLETE/);
assert.match(background, /const startupRollovers = reviewActiveRolloverSummaries\(\)/);
assert.match(background, /for \(const startupRollover of startupRollovers\)/);
assert.match(background, /reviewQueueRollover\(\(\) => reviewResumeThreadRollover\(startupRollover\.side\)\)/);
assert.doesNotMatch(background, /const startupRollover = reviewActiveRolloverSummary\(\)/);

assert.doesNotMatch(
  background,
  /Automatic New Chat is LIMITED until trusted provider New Chat authority is available/,
  "legacy pause-only thread-limit handler must not remain"
);

assert.match(contentScript, /regions:\[\{kind:"provider-notice",text:signature,visible:true\}\]/);
assert.match(contentScript, /authorityRegistrationId:registration\.authorityRegistrationId/);
assert.match(contentScript, /conversationIdentity:liveIdentity/);
assert.match(contentScript, /rolloverId:responseContext\.rolloverId/);
assert.match(contentScript, /awaitingResponseContext/);
assert.match(contentScript, /limitSignatureKey=String\(awaitingDispatchId\|\|"none"\)\+"::"\+signature/);

const routeStart = contentScript.indexOf("routeTimer=setInterval");
const routeEnd = contentScript.indexOf("const onRuntimeMessage", routeStart);
const routeBlock = contentScript.slice(routeStart, routeEnd);
assert.doesNotMatch(routeBlock, /byCommand\.clear\(\)|byAuthority\.clear\(\)/,
  "SPA route changes must preserve bounded action proof cache");

assert.match(signatures, /chatgpt:[\s\S]*maximum length for this conversation/i);
assert.match(signatures, /grok:\s*Object\.freeze\(\{ required:Object\.freeze\(\[\]\)/,
  "Grok must remain fail-closed until a trusted signature exists");

console.log("round47-automatic-thread-rollover-runtime: PASS");
