import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const repoRoot=path.resolve(here,"../..");

for(const rel of [
  "AI_OUTPUT/runtime_review/content.js"
]){
  const source=fs.readFileSync(path.join(repoRoot,rel),"utf8");
  const start=source.indexOf("async function performSend(command)");
  const end=source.indexOf("async function handleAction",start);
  assert.ok(start>=0&&end>start,rel+": performSend missing");
  const send=source.slice(start,end);
  const draftIndex=send.indexOf("setComposerText(composer2,text);");
  assert.ok(draftIndex>=0,rel+": draft insertion missing");

  // No provider Send authority is resolved before the verified composer receives
  // the draft. Conditional controls are authorized only after insertion.
  assert.doesNotMatch(
    send.slice(0,draftIndex),
    /resolveTrustedSend\(/,
    rel+": Send authority must not be required before draft insertion"
  );

  assert.ok(
    source.includes('(resolveTrusted(config.send) || (resolveTrusted(config.composer) && config.send.length)) ? "PASS" : "FAIL"'),
    rel+": health must support provider-controlled conditional Send rendering"
  );
  assert.ok(send.includes('const composer1=await waitForTrusted(config.composer,{attempts:80,delayMs:100});'),
    rel+": composer authority must use the bounded trusted-selector mount window");
  assert.ok(send.includes('const detail=`COMPOSER provider=${provider}; matched=${stats.matched}; visible=${stats.visible}; enabled=${stats.enabled}`;'),
    rel+": unavailable composer diagnostics must remain non-sensitive");
  assert.ok(send.includes('reject(command,"DOM_AUTHORITY_UNAVAILABLE",detail)'),
    rel+": unavailable composer must fail closed");
  assert.ok(send.includes("const identityAfterComposerWait=routeIdentity()"),
    rel+": route identity must be re-proven after composer wait");
  assert.ok(send.includes("for(let i=0;i<80;i++)"),
    rel+": conditional Send rendering wait must be bounded");
  assert.ok(send.includes("resolveTrustedSend(composer2,{requireEnabled:true})"),
    rel+": post-draft Send must use the provider-aware trusted resolver");
  assert.ok(send.includes('reject(command,"DOM_AUTHORITY_NOT_ACTIONABLE",detail)'),
    rel+": absent/non-actionable Send must fail closed");
  assert.ok(send.includes("const identityAfterDraft=routeIdentity()"),
    rel+": conversation identity must be re-proven after typing");
  assert.ok(send.includes("const sendAgain=resolveTrustedSend(composer2,{requireEnabled:true})"),
    rel+": Send authority must be re-proven immediately before action");
  assert.ok(send.includes("const sameSendAction=Boolean("),
    rel+": final action identity must be stable");
  assert.ok(send.includes('if(sendAgain.kind==="button")'),
    rel+": button action path missing");
  assert.ok(send.includes("sendAgain.node.click();"),
    rel+": verified button must be clicked");
  assert.ok(send.includes("sendAgain.form.requestSubmit();"),
    rel+": verified Grok form fallback missing");
}


console.log("dom-authority-conditional-send: PASS");
