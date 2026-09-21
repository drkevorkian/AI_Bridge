import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"..");
const content=fs.readFileSync(path.join(root,"runtime_review","content.js"),"utf8");
const bg=fs.readFileSync(path.join(root,"runtime_review","background.js"),"utf8");
const dash=fs.readFileSync(path.join(root,"runtime_review","dashboard.js"),"utf8");
const manifest=JSON.parse(fs.readFileSync(path.join(root,"runtime_review","manifest.json"),"utf8");

assert.ok(content.includes("let lastObservedNode = null;"));
assert.ok(content.includes("observation.node!==lastObservedNode"));
assert.ok(content.includes("lastObservedNode=observation.node"));
assert.doesNotMatch(
  content,
  /if\(text!==lastObserved \|\| observation\.node!==awaitingResponseBaselineNode\)/
);
assert.ok(
  content.includes(
    'sendResponse({ok:Boolean(text),text,active:generationActive(),host,provider,identity:routeIdentity()})'
  )
);

assert.ok(bg.includes("function reviewManualRelayAwaitingDispatch"));
assert.ok(bg.includes("MANUAL_RELAY_NO_AWAITING_DISPATCH"));
assert.ok(bg.includes("reviewProcessIncomingEnvelope(envelope)"));
assert.ok(bg.includes('state.runtimePhase="MANUAL_RELAY_RECOVERY"'));
assert.doesNotMatch(
  bg,
  /if \(state\.running\) throw new Error\("Pause the session before using Manual Relay\."\)/
);
assert.ok(bg.includes("recoveredDispatchId:recovered.dispatchId"));

// Direct Mesh routing must remain downstream of the response commit path.
assert.ok(bg.includes("function extractRegisteredLlmCommand(text, fromSide)"));
assert.ok(bg.includes("const command = extractRegisteredLlmCommand(text, side);"));
assert.ok(bg.includes("const targetSide = command?.targetSide || nextSide(side);"));
assert.ok(bg.includes("directTurnMessage(side, targetSide, entry)"));
assert.ok(bg.includes("DIRECT-MESH COMMAND PROTOCOL:"));
assert.ok(bg.includes("SEND TO: AI "));

assert.doesNotMatch(
  dash,
  /\$\("forceRelayBtn"\)\.disabled = !s\.sessionActive \|\| s\.running/
);
assert.ok(
  dash.includes(
    "Recovering AI ${manualRelaySource}'s last completed reply and freezing automatic progression…"
  )
);
assert.match(manifest.version_name,/^1\\.19\\.1\\.(?:3[3-9]|[4-9][0-9])-AI-[A-Z]$/);
console.log("round73-response-detection-manual-relay: PASS");
