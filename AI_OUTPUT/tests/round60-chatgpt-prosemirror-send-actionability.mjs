import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const contentJs=fs.readFileSync(path.join(here,"../runtime_review/content.js"),"utf8");

assert.ok(
  contentJs.includes('composer: Object.freeze(["#prompt-textarea"])'),
  "ChatGPT composer authority must remain pinned to #prompt-textarea"
);
assert.ok(
  contentJs.includes('send: Object.freeze(["button[data-testid=\'send-button\']","button[aria-label=\'Send prompt\']","button#composer-submit-button"])'),
  "ChatGPT Send authority must remain pinned to reviewed selectors"
);

const setterStart=contentJs.indexOf("function setComposerText");
const sleepStart=contentJs.indexOf("async function sleep",setterStart);
assert.ok(setterStart>=0&&sleepStart>setterStart,"composer setter boundary missing");
const setter=contentJs.slice(setterStart,sleepStart);

for(const token of [
  "if(node.isContentEditable)",
  "range.selectNodeContents(node);",
  "selection.removeAllRanges();",
  "selection.addRange(range);",
  'document.queryCommandSupported("insertText")',
  'document.execCommand("insertText",false,value)===true',
  "if(inserted && getComposerText(node).trim()===value.trim()) return;",
  "node.replaceChildren();",
  'node.dispatchEvent(new InputEvent("input",{',
  "cancelable:true",
  "composed:true",
  'node.dispatchEvent(new Event("change",{bubbles:true,composed:true}));'
]) assert.ok(setter.includes(token),"contenteditable insertion contract missing "+token);

const statsStart=contentJs.indexOf("function trustedSelectorStats(selectors)");
const sendStart=contentJs.indexOf("async function performSend");
assert.ok(statsStart>=0&&statsStart<sendStart,"safe Send-selector diagnostics helper missing");
const statsBlock=contentJs.slice(statsStart,sendStart);
for(const token of [
  "const matched=new Set();",
  "const visibleNodes=new Set();",
  "const enabledNodes=new Set();",
  "matched:matched.size",
  "visible:visibleNodes.size",
  "enabled:enabledNodes.size"
]) assert.ok(statsBlock.includes(token),"Send-selector diagnostic contract missing "+token);
assert.doesNotMatch(
  statsBlock,
  /innerText|textContent|composerText=|promptText=/,
  "Send diagnostics must not expose composer or provider text"
);

const sendStartMarker=sendStart;
const handleStart=contentJs.indexOf("async function handleAction",sendStartMarker);
assert.ok(sendStartMarker>=0&&handleStart>sendStartMarker,"performSend boundary missing");
const send=contentJs.slice(sendStartMarker,handleStart);

for(const token of [
  "setComposerText(composer2,text);",
  "for(let i=0;i<80;i++)",
  "resolveTrusted(config.send,{requireEnabled:true})",
  "const stats=trustedSelectorStats(config.send);",
  "const composerChars=getComposerText(composer2).length;",
  'reject(command,"DOM_AUTHORITY_NOT_ACTIONABLE",detail)',
  'matched=${stats.matched}',
  'visible=${stats.visible}',
  'enabled=${stats.enabled}',
  "const identityAfterDraft=routeIdentity()",
  "const sendAgain=resolveTrusted(config.send,{requireEnabled:true})",
  "sendAgain.click();"
]) assert.ok(send.includes(token),"SEND authority contract missing "+token);

assert.ok(
  send.indexOf("setComposerText(composer2,text);") <
  send.indexOf("resolveTrusted(config.send,{requireEnabled:true})"),
  "draft insertion must occur before actionable Send proof"
);
assert.ok(
  send.indexOf("const sendAgain=resolveTrusted(config.send,{requireEnabled:true})") <
  send.indexOf("sendAgain.click();"),
  "final trusted Send proof must immediately precede the click path"
);

assert.doesNotMatch(
  send,
  /dispatchEvent\(new KeyboardEvent|key\s*:\s*["']Enter["']/,
  "ChatGPT SEND recovery must not bypass button authority with synthetic Enter"
);
assert.doesNotMatch(
  contentJs,
  /button\[type=['"]submit['"]\]/,
  "ChatGPT authority must not broaden to generic submit buttons"
);

console.log("round60-chatgpt-prosemirror-send-actionability: PASS");
