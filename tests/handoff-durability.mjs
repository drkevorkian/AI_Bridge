import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const background=fs.readFileSync(path.join(root,"background.js"),"utf8");

for (const token of [
  "pendingHandoff",
  "PREPARED",
  "ACTION_ATTEMPTED",
  "ACK_RECEIVED",
  "AMBIGUOUS",
  "FALLBACK_ACTION_ATTEMPTED",
  "payloadHash",
  "handoffId"
]) assert.ok(background.includes(token),"missing durable handoff token "+token);

assert.match(background,/Prompt send outcome is ambiguous; AI Bridge will not automatically retry this handoff/);
assert.match(background,/Text-fallback send outcome is ambiguous; AI Bridge will not automatically retry this handoff/);
assert.match(background,/AI Bridge will not resend an ACKed prompt automatically/);
assert.doesNotMatch(background,/catch \(_\) \{\s*await ensureTabListener\(tabId\);\s*result = await chrome\.tabs\.sendMessage/s,
  "lost send ACK must not trigger a blind retry");
assert.match(background,/\["ACTION_ATTEMPTED", "FALLBACK_ACTION_ATTEMPTED", "AMBIGUOUS"\]/);
assert.match(background,/requires recovery; AI Bridge will not automatically resend/);
assert.match(background,/crypto\.subtle\.digest\("SHA-256"/);

console.log("AI Bridge durable handoff lifecycle: OK");
