import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"../..");
const STATUS=Object.freeze({
  CREATED:"CREATED",
  DISPATCHING:"DISPATCHING",
  ACCEPTED:"ACCEPTED",
  AWAITING_RESPONSE:"AWAITING_RESPONSE",
  DELIVERY_AMBIGUOUS:"DELIVERY_AMBIGUOUS",
  RESPONSE_COMMITTED:"RESPONSE_COMMITTED",
  FAILED:"FAILED"
});

function extractFinder(source){
  const start=source.indexOf("function reviewFindUnresolvedDispatch");
  const end=source.indexOf("\nasync function reviewTransitionDispatch",start);
  assert.ok(start>=0&&end>start,"reviewFindUnresolvedDispatch block missing");
  const fnText=source.slice(start,end).trim();
  return records=>new Function(
    "DISPATCH_STATUS",
    "reviewLedger",
    "return ("+fnText+");"
  )(STATUS,{snapshot:()=>records.map(r=>({...r}))});
}

for(const rel of [
  "AI_OUTPUT/runtime_review/background.js",
  "AI_INPUT/background.js"
]){
  const source=fs.readFileSync(path.join(root,rel),"utf8");
  const makeFinder=extractFinder(source);

  // An older unresolved B dispatch from another continuation must not poison
  // the currently recovered continuation.
  {
    const records=[
      {dispatchId:"old",side:"B",status:STATUS.AWAITING_RESPONSE,payloadHash:"old-hash",continuationSourceDispatchId:"source-old",createdAt:100},
      {dispatchId:"current",side:"B",status:STATUS.CREATED,payloadHash:"new-hash",continuationSourceDispatchId:"source-new",createdAt:300}
    ];
    const find=makeFinder(records);
    const result=find("B","new-hash",{continuationSourceDispatchId:"source-new",continuationCreatedAt:250});
    assert.equal(result.exact?.dispatchId,"current",rel+": current CREATED dispatch should be reusable");
    assert.equal(result.blocking,null,rel+": unrelated old continuation must not block");
  }

  // A same-transaction AWAITING_RESPONSE is never replayable through sendToSide;
  // adoption must handle it before sendToSide is reached.
  {
    const records=[
      {dispatchId:"waiting",side:"B",status:STATUS.AWAITING_RESPONSE,payloadHash:"new-hash",continuationSourceDispatchId:"source-new",createdAt:300}
    ];
    const result=makeFinder(records)("B","new-hash",{continuationSourceDispatchId:"source-new",continuationCreatedAt:250});
    assert.equal(result.exact,null,rel+": awaiting response may not be reused as a send");
    assert.equal(result.blocking?.dispatchId,"waiting",rel+": same-transaction awaiting response must remain protected");
  }

  // Legacy records without provenance are accepted only inside the pending
  // continuation's time domain.
  {
    const oldLegacy={dispatchId:"legacy-old",side:"B",status:STATUS.AWAITING_RESPONSE,payloadHash:"x",continuationSourceDispatchId:null,createdAt:100};
    const result=makeFinder([oldLegacy])("B","new-hash",{continuationSourceDispatchId:"source-new",continuationCreatedAt:250});
    assert.equal(result.blocking,null,rel+": legacy record older than pending turn must not poison recovery");
  }
  {
    const currentLegacy={dispatchId:"legacy-current",side:"B",status:STATUS.AWAITING_RESPONSE,payloadHash:"new-hash",continuationSourceDispatchId:null,createdAt:300};
    const result=makeFinder([currentLegacy])("B","new-hash",{continuationSourceDispatchId:"source-new",continuationCreatedAt:250});
    assert.equal(result.blocking?.dispatchId,"legacy-current",rel+": in-domain legacy unresolved record must remain protected");
  }

  // Multiple pre-action copies of the same continuation are not silently chosen.
  {
    const records=[
      {dispatchId:"c1",side:"B",status:STATUS.CREATED,payloadHash:"new-hash",continuationSourceDispatchId:"source-new",createdAt:300},
      {dispatchId:"c2",side:"B",status:STATUS.CREATED,payloadHash:"new-hash",continuationSourceDispatchId:"source-new",createdAt:301}
    ];
    const result=makeFinder(records)("B","new-hash",{continuationSourceDispatchId:"source-new",continuationCreatedAt:250});
    assert.equal(result.exact,null,rel+": multiple CREATED candidates must not be guessed");
    assert.equal(result.blocking?.dispatchId,"c2",rel+": duplicate CREATED candidates must block");
  }

  assert.ok(source.includes("async function reviewRetireStaleCreatedDispatches"),rel+": stale CREATED cleanup missing");
  const cleanupStart=source.indexOf("async function reviewRetireStaleCreatedDispatches");
  const cleanupEnd=source.indexOf("\nfunction reviewFindUnresolvedDispatch",cleanupStart);
  const cleanup=source.slice(cleanupStart,cleanupEnd);
  assert.match(cleanup,/record\.status\s*!==\s*DISPATCH_STATUS\.CREATED/);
  assert.doesNotMatch(cleanup,/record\.status\s*===\s*DISPATCH_STATUS\.(?:AWAITING_RESPONSE|DELIVERY_AMBIGUOUS|ACCEPTED|DISPATCHING)/);
  assert.ok(source.includes("UNRESOLVED_DISPATCH_BLOCKS_REPLAY:\" + blockerDetail"),
    rel+": blocker diagnostics must expose exact status/id/provenance");
}

console.log("round45-transaction-scoped-recovery: PASS");
