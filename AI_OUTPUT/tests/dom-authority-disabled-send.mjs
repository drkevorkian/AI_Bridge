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

  assert.ok(
    source.includes('send: resolveTrusted(config.send) ? "PASS" : "FAIL"'),
    rel+": health authority must be based on unique trusted Send presence, not empty-composer enabled state"
  );
  assert.ok(send.includes("const send1=resolveTrusted(config.send);"),
    rel+": initial Send authority must allow disabled control");
  assert.ok(send.includes("const send2=resolveTrusted(config.send);"),
    rel+": stability check must allow disabled control");
  assert.doesNotMatch(
    send.slice(0,send.indexOf("setComposerText(composer2,text);")),
    /resolveTrusted\(config\.send,\{requireEnabled:true\}\)/,
    rel+": must not require enabled Send before inserting draft"
  );
  assert.ok(send.includes("setComposerText(composer2,text);"),
    rel+": draft insertion missing");
  assert.ok(send.includes("for(let i=0;i<12;i++)"),
    rel+": enabled-state transition must be bounded");
  assert.ok(send.includes('resolveTrusted(config.send,{requireEnabled:true})'),
    rel+": Send must become enabled before click");
  assert.ok(send.includes('reject(command,"DOM_AUTHORITY_NOT_ACTIONABLE")'),
    rel+": non-actionable Send must fail closed");
  assert.ok(
    send.indexOf("setComposerText(composer2,text);") <
    send.indexOf("resolveTrusted(config.send,{requireEnabled:true})"),
    rel+": enabled Send check must occur after draft insertion"
  );
}

console.log("dom-authority-disabled-send: PASS");
