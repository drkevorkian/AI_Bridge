import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const repoRoot=path.resolve(here,"../..");

for(const rel of [
  "AI_OUTPUT/runtime_review/content.js",
  "AI_INPUT/content.js"
]){
  const source=fs.readFileSync(path.join(repoRoot,rel),"utf8");

  assert.ok(
    source.includes('composer: Object.freeze(["#prompt-textarea"])'),
    rel+": ChatGPT composer authority must remain pinned to the reviewed exact selector"
  );
  assert.doesNotMatch(
    source,
    /chatgpt:[\s\S]{0,300}composer:[\s\S]{0,200}(textarea(?!#prompt-textarea)|\[contenteditable=['"]true['"]\])/,
    rel+": ChatGPT composer authority must not broaden to generic editable elements"
  );

  const waitStart=source.indexOf("async function waitForTrusted");
  const confirmStart=source.indexOf("async function confirmSend",waitStart);
  assert.ok(waitStart>=0&&confirmStart>waitStart,rel+": bounded authority wait helper missing");
  const wait=source.slice(waitStart,confirmStart);
  for(const token of [
    "Math.max(1,Math.min(80,Number(attempts)||1))",
    "Math.max(0,Math.min(250,Number(delayMs)||0))",
    "resolveTrusted(selectors,{requireEnabled})",
    "await sleep(boundedDelay)",
    "return null;"
  ]) assert.ok(wait.includes(token),rel+": bounded wait contract missing "+token);

  const sendStart=source.indexOf("async function performSend(command)");
  const sendEnd=source.indexOf("async function handleAction",sendStart);
  assert.ok(sendStart>=0&&sendEnd>sendStart,rel+": performSend boundary missing");
  const send=source.slice(sendStart,sendEnd);

  for(const token of [
    'const composer1=await waitForTrusted(config.composer,{attempts:40,delayMs:75});',
    "const stats=trustedSelectorStats(config.composer);",
    'const detail=`COMPOSER provider=${provider}; matched=${stats.matched}; visible=${stats.visible}; enabled=${stats.enabled}`;',
    'reject(command,"DOM_AUTHORITY_UNAVAILABLE",detail)',
    "const identityAfterComposerWait=routeIdentity()",
    "sameIdentity(identityAfterComposerWait,command.expectedIdentity)",
    "sameIdentity(identityAfterComposerWait,registration.identity)",
    "const composer2=resolveTrusted(config.composer);",
    'reject(command,"DOM_AUTHORITY_CHANGED","COMPOSER")'
  ]) assert.ok(send.includes(token),rel+": composer-mount authority contract missing "+token);

  assert.ok(
    send.indexOf("const identityAfterComposerWait=routeIdentity()") <
    send.indexOf("setComposerText(composer2,text);"),
    rel+": identity must be re-proven before any draft mutation"
  );
  assert.doesNotMatch(
    send.slice(0,send.indexOf("setComposerText(composer2,text);")),
    /\.click\(|dispatchEvent\(new KeyboardEvent|key\s*:\s*["']Enter["']/,
    rel+": composer recovery must not perform an action before authority is re-proven"
  );
}

console.log("round70-bounded-composer-mount: PASS");
