import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const bg=fs.readFileSync(path.join(here,"../runtime_review/background.js"),"utf8");

const start=bg.indexOf("function reviewFindUnresolvedDispatch");
const end=bg.indexOf("\nasync function reviewTransitionDispatch",start);
assert.ok(start>=0&&end>start,"unresolved-dispatch lookup missing");
const fnSource=bg.slice(start,end);

const DISPATCH_STATUS={
  CREATED:"CREATED",
  DISPATCHING:"DISPATCHING",
  ACCEPTED:"ACCEPTED",
  AWAITING_RESPONSE:"AWAITING_RESPONSE",
  DELIVERY_AMBIGUOUS:"DELIVERY_AMBIGUOUS"
};

function lookup(records,opts={}){
  const reviewLedger={snapshot:()=>records.map(r=>({...r}))};
  const fn=(new Function(
    "DISPATCH_STATUS","reviewLedger",
    fnSource+"; return reviewFindUnresolvedDispatch;"
  ))(DISPATCH_STATUS,reviewLedger);
  return fn("B","current-hash",opts);
}

const pending={continuationSourceDispatchId:"source-current",continuationCreatedAt:5000};

// Old unresolved AI B work from a previous/inactive transaction domain must
// not poison the current continuation.
{
  const result=lookup([{
    dispatchId:"old",
    side:"B",
    payloadHash:"old-hash",
    status:"AWAITING_RESPONSE",
    createdAt:1000,
    continuationSourceDispatchId:null
  }],pending);
  assert.equal(result.exact,null);
  assert.equal(result.blocking,null);
}

// Old same-text records are also stale if they predate the durable continuation.
{
  const result=lookup([{
    dispatchId:"old-same-text",
    side:"B",
    payloadHash:"current-hash",
    status:"AWAITING_RESPONSE",
    createdAt:1000,
    continuationSourceDispatchId:null
  }],pending);
  assert.equal(result.exact,null);
  assert.equal(result.blocking,null);
}

// A legacy record created inside the current continuation window remains
// relevant and must block unless the dedicated recovery path adopts it.
{
  const result=lookup([{
    dispatchId:"current-awaiting",
    side:"B",
    payloadHash:"current-hash",
    status:"AWAITING_RESPONSE",
    createdAt:5100,
    continuationSourceDispatchId:null
  }],pending);
  assert.equal(result.exact,null);
  assert.equal(result.blocking?.dispatchId,"current-awaiting");
}

// New provenance is stronger than timestamps.
{
  const result=lookup([{
    dispatchId:"wrong-source",
    side:"B",
    payloadHash:"current-hash",
    status:"AWAITING_RESPONSE",
    createdAt:5100,
    continuationSourceDispatchId:"source-other"
  }],pending);
  assert.equal(result.exact,null);
  assert.equal(result.blocking,null);
}

// Exactly one current CREATED dispatch may be reused without a second create.
{
  const result=lookup([{
    dispatchId:"current-created",
    side:"B",
    payloadHash:"current-hash",
    status:"CREATED",
    createdAt:5100,
    continuationSourceDispatchId:"source-current"
  }],pending);
  assert.equal(result.exact?.dispatchId,"current-created");
  assert.equal(result.blocking,null);
}

assert.ok(bg.includes("async function reviewResetSessionDurability()"));
assert.ok(bg.includes("[REVIEW_DISPATCH_KEY]: { records: [] }"));
assert.ok(bg.includes("aiBridgeRuntimeParkedResponses: { records: [] }"));
assert.ok(bg.includes("reviewLedger = new DispatchLedger();"));
assert.ok(bg.includes("reviewRollover = new RolloverCoordinator();"));
assert.ok(bg.includes("await reviewResetSessionDurability();"));

const resetCall=bg.indexOf("await reviewResetSessionDurability();");
const firstStartSend=bg.indexOf("await sendToSide(state.startSide",resetCall);
assert.ok(resetCall>=0&&firstStartSend>resetCall,
  "new-session durability reset must precede the initial provider send");

console.log("round45-session-durability-isolation: PASS");
