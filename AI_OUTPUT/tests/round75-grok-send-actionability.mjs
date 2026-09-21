import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"..");
const content=fs.readFileSync(path.join(root,"runtime_review","content.js"),"utf8");
const contracts=fs.readFileSync(path.join(root,"dom_resilience","provider-dom-contracts.js"),"utf8");
const manifest=JSON.parse(fs.readFileSync(path.join(root,"runtime_review","manifest.json"),"utf8"));

for(const selector of [
  "div.ProseMirror[data-testid='chat-input'][contenteditable='true'][role='textbox']",
  "[data-testid='chat-input'] div.ProseMirror[contenteditable='true'][role='textbox']",
  "[data-testid='assistant-message']"
]) assert.ok(content.includes(selector),"current Grok DOM anchor missing: "+selector);

for(const selector of [
  "button[data-testid='send-button']",
  "button[aria-label='Send message']",
  "button[aria-label='Send']",
  "button[aria-label='Submit']"
]) assert.ok(content.includes(selector),"Grok semantic Send selector missing: "+selector);

const helperStart=content.indexOf("function grokComposerSubmissionForm(composer)");
const helperEnd=content.indexOf("function routeIdentity()",helperStart);
assert.ok(helperStart>=0&&helperEnd>helperStart,"Grok scoped send helper boundary missing");
const helper=content.slice(helperStart,helperEnd);
for(const token of [
  'provider!=="grok"',
  'composer.closest?.("[data-testid=\'chat-input\']")',
  'composer.closest?.("form")',
  'form.contains(chatInput)',
  'form.querySelectorAll("button[type=\'submit\']")',
  'submits.length===1',
  'typeof form.requestSubmit==="function"',
  'kind:"requestSubmit"'
]) assert.ok(helper.includes(token),"Grok scoped authority missing "+token);

assert.doesNotMatch(
  helper,
  /document\.querySelectorAll\("button\[type=['"]submit['"]\]"\)/,
  "Grok structural submit must never be resolved page-wide"
);

const sendStart=content.indexOf("async function performSend(command)");
const sendEnd=content.indexOf("async function handleAction",sendStart);
assert.ok(sendStart>=0&&sendEnd>sendStart,"performSend boundary missing");
const send=content.slice(sendStart,sendEnd);
for(const token of [
  "setComposerText(composer2,text);",
  "resolveTrustedSend(composer2,{requireEnabled:true})",
  "const identityAfterDraft=routeIdentity()",
  "const sameSendAction=Boolean(",
  'if(sendAgain.kind==="button")',
  "sendAgain.node.click();",
  "sendAgain.form.requestSubmit();",
  "const confirmation=await confirmSend(composer2,text);"
]) assert.ok(send.includes(token),"Grok send action contract missing "+token);

assert.ok(
  send.indexOf("setComposerText(composer2,text);") <
  send.indexOf("resolveTrustedSend(composer2,{requireEnabled:true})"),
  "draft insertion must precede Send authority"
);
assert.ok(
  send.indexOf("const identityAfterDraft=routeIdentity()") <
  send.indexOf('if(sendAgain.kind==="button")'),
  "identity proof must precede Grok submission"
);
assert.ok(
  send.indexOf("const sameSendAction=Boolean(") <
  send.indexOf('if(sendAgain.kind==="button")'),
  "final Send authority proof must precede submission"
);

for(const token of [
  'grok-composer-chat-input-direct',
  'grok-composer-chat-input',
  'grok-send-testid',
  'grok-send-submit',
  'grok-assistant-testid'
]) assert.ok(contracts.includes(token),"DOM resilience contract missing "+token);

assert.equal(manifest.version_name,"1.19.1.35-AI-A");
console.log("round75-grok-send-actionability: PASS");
