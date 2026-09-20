import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const require=createRequire(import.meta.url);
const {DispatchLedger,DISPATCH_STATUS}=require("../thread_rollover/dispatch-ledger.js");

const identity=Object.freeze({
  provider:"chatgpt",
  kind:"conversation",
  routeClass:"conversation",
  threadKey:"thread-A",
  provisional:false,
  writable:true
});

function created(id){
  const ledger=new DispatchLedger();
  ledger.create({
    dispatchId:id,
    side:"B",
    tabId:42,
    generationEpoch:7,
    conversationIdentity:identity,
    purpose:"RELAY",
    payloadHash:"hash-"+id,
    createdAt:1000
  });
  ledger.transition(id,DISPATCH_STATUS.DISPATCHING);
  return ledger;
}

// Proven background acceptance survives worker restart as AWAITING_RESPONSE.
{
  const ledger=created("accepted");
  ledger.transition("accepted",DISPATCH_STATUS.ACCEPTED,{acceptedAt:1100});
  const recovered=ledger.recoverAcceptedAfterRestart("accepted");
  assert.equal(recovered.status,DISPATCH_STATUS.AWAITING_RESPONSE);
  assert.equal(recovered.acceptedAt,1100);
  assert.equal(recovered.failureReason,"");
}

// Legacy builds incorrectly downgraded ACCEPTED to restart ambiguity. acceptedAt
// is durable proof and must repair without replay.
{
  const ledger=created("legacy-accepted");
  ledger.transition("legacy-accepted",DISPATCH_STATUS.ACCEPTED,{acceptedAt:1100});
  ledger.transition("legacy-accepted",DISPATCH_STATUS.DELIVERY_AMBIGUOUS,{
    failureReason:"MV3_WORKER_RESTART_DURING_DELIVERY"
  });
  const recovered=ledger.recoverAcceptedAfterRestart("legacy-accepted");
  assert.equal(recovered.status,DISPATCH_STATUS.AWAITING_RESPONSE);
  assert.equal(recovered.acceptedAt,1100);
}

// DISPATCHING without background acceptance remains fail-closed unless the
// isolated content runtime proves the exact SEND reached ACTION_CONFIRMED.
{
  const ledger=created("dispatching");
  ledger.transition("dispatching",DISPATCH_STATUS.DELIVERY_AMBIGUOUS,{
    failureReason:"MV3_WORKER_RESTART_DURING_DELIVERY"
  });
  assert.throws(
    ()=>ledger.recoverAcceptedAfterRestart("dispatching"),
    /Content action proof is required/
  );
  assert.throws(
    ()=>ledger.recoverAcceptedAfterRestart("dispatching",{contentProof:{
      authorityId:"dispatching",
      action:"SEND",
      outcome:"ACTION_ATTEMPTED",
      side:"B",
      generationEpoch:7,
      conversationIdentity:identity
    },recoveredAt:1200}),
    /does not confirm provider action/
  );
  const recovered=ledger.recoverAcceptedAfterRestart("dispatching",{contentProof:{
    authorityId:"dispatching",
    action:"SEND",
    outcome:"ACTION_CONFIRMED",
    side:"B",
    generationEpoch:7,
    conversationIdentity:identity
  },recoveredAt:1200});
  assert.equal(recovered.status,DISPATCH_STATUS.AWAITING_RESPONSE);
  assert.equal(recovered.acceptedAt,1200);
}

// Provider/network ambiguity must never be laundered through restart recovery.
{
  const ledger=created("network");
  ledger.transition("network",DISPATCH_STATUS.DELIVERY_AMBIGUOUS,{
    failureReason:"MESSAGE_ACK_LOST"
  });
  assert.throws(
    ()=>ledger.recoverAcceptedAfterRestart("network",{contentProof:{
      authorityId:"network",
      action:"SEND",
      outcome:"ACTION_CONFIRMED",
      side:"B",
      generationEpoch:7,
      conversationIdentity:identity
    },recoveredAt:1200}),
    /Only worker-restart delivery ambiguity/
  );
}

const bg=fs.readFileSync(path.join(here,"../runtime_review/background.js"),"utf8");
const contentScript=fs.readFileSync(path.join(here,"../runtime_review/content.js"),"utf8");

assert.ok(bg.includes("record.status === DISPATCH_STATUS.ACCEPTED"));
assert.ok(bg.includes("reviewLedger.recoverAcceptedAfterRestart(record.dispatchId)"));
assert.ok(bg.includes('record.failureReason === "MV3_WORKER_RESTART_DURING_DELIVERY"'));
assert.ok(bg.includes("async function reviewReadContentActionProof"));
assert.ok(bg.includes('type: "AI_BRIDGE_ACTION_STATUS"'));
assert.ok(bg.includes('"ACTION_CONFIRMED"'));
assert.ok(bg.includes("RESTART_DELIVERY_AMBIGUOUS_NO_CONTENT_PROOF"));
assert.ok(contentScript.includes('if(msg.type==="AI_BRIDGE_ACTION_STATUS")'));
assert.ok(contentScript.includes('byAuthority.get(action+":"+authorityId)'));

console.log("round44-restart-delivery-recovery: PASS");
