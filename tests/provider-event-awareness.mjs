import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const content=fs.readFileSync(path.join(root,"content.js"),"utf8");
const background=fs.readFileSync(path.join(root,"background.js"),"utf8");
const dashboard=fs.readFileSync(path.join(root,"dashboard.js"),"utf8");

for(const token of [
  "AI_BRIDGE_PROVIDER_EVENT",
  "MESSAGE_DELIVERY_TIMEOUT",
  "CONNECTION_INTERRUPTED",
  "NETWORK_ERROR",
  "GENERATION_ERROR",
  "RATE_LIMIT",
  "USAGE_LIMIT",
  "AUTH_REQUIRED",
  "CONTENT_BLOCKED",
  "providerEventCandidates",
  "inspectProviderEvents"
]) assert.ok(content.includes(token),"content missing "+token);

assert.match(content,/closest\?\.\("\[data-message-author-role='assistant'/,
  "provider-event scan must exclude model message bodies");
assert.match(background,/recordTranscript\("provider-event"/);
assert.match(background,/entry\?\.type !== "provider-event"/,
  "provider events must stay out of AI-to-AI recovery context");
assert.match(background,/Delivery is ambiguous, so AI Bridge did not resend automatically/);
assert.match(background,/if \(state\.sessionActive && state\.running && deliveryAmbiguous\)/);
assert.match(dashboard,/entry\.type === "provider-event"/);
assert.match(dashboard,/Provider event · AI/);
assert.match(dashboard,/e\.type === "provider-event"/);

console.log("AI Bridge provider operational-event awareness: OK");
