import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const background=fs.readFileSync(path.join(root,"background.js"),"utf8");

for(const token of [
  "rolloverBySide",
  "PREPARING",
  "FRESH_CHAT_READY",
  "SENDING_CONTINUITY",
  "CONTINUITY_SENT",
  "function rolloverContinuityMessage",
  "async function performThreadRollover",
  "THREAD ROLLOVER CONTINUITY:",
  "continuityHash",
  "Interrupted thread rollover",
  "will not resend an ambiguous continuity prompt automatically"
]) assert.ok(background.includes(token),"rollover missing "+token);

assert.match(background,/await resetChatTab\(tabId\)/);
assert.match(background,/await sendToSide\(side, outgoing\.text,/);
assert.match(background,/const rollover = await performThreadRollover\(side,/);
assert.match(background,/rollover\?\.phase === "CONTINUITY_SENT"/);
assert.match(background,/state\.rolloverBySide\[side\] = null/);
assert.doesNotMatch(background,/DispatchLedger|ParkedResponseStore|STATE_VERSION = 4/);

console.log("AI Bridge lightweight thread rollover: OK");
