import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const repoRoot=path.resolve(here,"../..");

for(const rel of [
  "AI_OUTPUT/runtime_review/content.js",
  "AI_INPUT/content.js"
]){
  const source=fs.readFileSync(path.join(repoRoot,rel),"utf8");
  const start=source.indexOf("async function performSend(command)");
  const end=source.indexOf("async function handleAction",start);
  assert.ok(start>=0&&end>start,rel+": performSend missing");
  const send=source.slice(start,end);
  const draftIndex=send.indexOf("setComposerText(composer2,text);");
  assert.ok(draftIndex>=0,rel+": draft insertion missing");

  // Current ChatGPT can omit the Send control entirely until the draft exists.
  // No Send lookup is allowed before the trusted composer receives the draft.
  assert.doesNotMatch(
    send.slice(0,draftIndex),
    /resolveTrusted\(config\.send/,
    rel+": Send authority must not be required before draft insertion"
  );

  assert.ok(
    source.includes('(resolveTrusted(config.send) || (resolveTrusted(config.composer) && config.send.length)) ? "PASS" : "FAIL"'),
    rel+": health must support provider-controlled conditional Send rendering"
  );
  assert.ok(send.includes('reject(command,"DOM_AUTHORITY_UNAVAILABLE","COMPOSER")'),
    rel+": unavailable authority must identify composer phase");
  assert.ok(send.includes("for(let i=0;i<20;i++)"),
    rel+": conditional Send rendering wait must be bounded");
  assert.ok(send.includes("resolveTrusted(config.send,{requireEnabled:true})"),
    rel+": post-draft Send must be uniquely visible and enabled");
  assert.ok(send.includes('reject(command,"DOM_AUTHORITY_NOT_ACTIONABLE","SEND")'),
    rel+": absent/non-actionable post-draft Send must fail closed");
  assert.ok(send.includes("const identityAfterDraft=routeIdentity()"),
    rel+": conversation identity must be re-proven after typing");
  assert.ok(send.includes("const sendAgain=resolveTrusted(config.send,{requireEnabled:true})"),
    rel+": Send authority must be re-proven immediately before click");
  assert.ok(
    send.indexOf("sendAgain.click();") > send.indexOf("const sendAgain=resolveTrusted(config.send,{requireEnabled:true})"),
    rel+": click must follow final authority proof"
  );
}

console.log("dom-authority-conditional-send: PASS");
