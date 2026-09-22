import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const content=fs.readFileSync(path.join(root,"content.js"),"utf8");
const dom=fs.readFileSync(path.join(root,"dom-resilience.js"),"utf8");

assert.match(content,/function trustedAuthority\(kind,/);
assert.match(content,/function trustedComposer\(\)/);
assert.match(content,/const input = trustedComposer\(\);/);
assert.match(content,/Could not prove trusted composer authority/);
assert.match(content,/Trusted composer authority changed before send/);
assert.match(content,/trustedAuthority\("send"\)/);
assert.match(content,/Trusted Send authority changed before action/);
assert.match(content,/input\?\.closest\?\.\("form"\)/);
assert.match(content,/sendAction\.form\.requestSubmit\(\)/);
assert.doesNotMatch(content,/new KeyboardEvent\("keydown"/);
assert.doesNotMatch(content,/document\.querySelectorAll\("button\[type='submit'\]/,
  "send fallback must remain scoped to the verified composer's form");

assert.match(dom,/grok-chat-input-prosemirror/);
assert.match(dom,/\[data-testid='chat-input'\]/);
assert.match(dom,/grok-send-testid/);
assert.match(dom,/button\[aria-label='Send message'\]/);
assert.match(dom,/chatgpt-send-testid/);
assert.match(dom,/gemini-send-aria/);
assert.match(dom,/claude-send-aria/);

console.log("AI Bridge provider send authority policy: OK");
