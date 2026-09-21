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
  contentJs.includes('send: Object.freeze(["button[data-testid=\'send-button\']","button[aria-label=\'Send prompt\']"])'),
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

const sendStart=contentJs.indexOf("async function performSend");
const handleStart=contentJs.indexOf("async function handleAction",sendStart);
assert.ok(sendStart>=0&&handleStart>sendStart,"performSend boundary missing");
const send=contentJs.slice(sendStart,handleStart);

for(const token of [
  "setComposerText(composer2,text);",
  "for(let i=0;i<20;i++)",
  "resolveTrusted(config.send,{requireEnabled:true})",
  'reject(command,"DOM_AUTHORITY_NOT_ACTIONABLE","SEND")',
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
