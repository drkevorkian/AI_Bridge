import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const bg=fs.readFileSync(path.join(here,"../runtime_review/background.js"),"utf8");

const tokens=[
  "async function reviewVerifyDurableRolloverContext",
  "ROLLOVER_PENDING_PROMPT_INTEGRITY_MISMATCH",
  "ROLLOVER_PROVIDER_SNAPSHOT_DURABLE_HASH_MISMATCH",
  "ROLLOVER_PROVIDER_SNAPSHOT_DURABLE_TIMESTAMP_MISMATCH",
  "ROLLOVER_PROVIDER_SNAPSHOT_DURABLE_IDENTITY_MISMATCH",
  "ROLLOVER_CONTINUITY_TEXT_INTEGRITY_MISMATCH",
  "const continuityText = await reviewVerifyDurableRolloverContext(tx, context, { requireContinuity:true });",
  "await reviewVerifyDurableRolloverContext(tx, context);",
  "payload:{text:continuityText,artifacts:[]}",
  "state.lastSentBySide[side] = continuityText"
];
for(const token of tokens) assert.ok(bg.includes(token),"missing "+token);

const finalPhase=bg.indexOf("if (tx.phase === ROLLOVER_PHASE.FINAL_RESPONSE_COMMITTED)");
const verify=bg.indexOf("await reviewVerifyDurableRolloverContext(tx, context);",finalPhase);
const prepare=bg.indexOf("reviewRolloverOrchestrator.prepareContinuity({",finalPhase);
assert.ok(finalPhase>=0&&verify>finalPhase&&prepare>verify,"snapshot/context integrity must be checked before continuity preparation");

const create=bg.indexOf("async function reviewCreateOrReuseContinuityDispatch");
const createVerify=bg.indexOf("reviewVerifyDurableRolloverContext(tx, context, { requireContinuity:true })",create);
const createLedger=bg.indexOf("reviewLedger.create({",create);
assert.ok(createVerify>create&&createLedger>createVerify,"canonical continuity must be verified before ledger creation");

const send=bg.indexOf("async function reviewSendContinuityDispatch");
const sendVerify=bg.indexOf("reviewVerifyDurableRolloverContext(tx, context, { requireContinuity:true })",send);
const dispatching=bg.indexOf("DISPATCH_STATUS.DISPATCHING",send);
assert.ok(sendVerify>send&&dispatching>sendVerify,"canonical continuity must be verified before provider send");

console.log("round49-rollover-restart-integrity: PASS");
