import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const background=fs.readFileSync(path.join(root,"background.js"),"utf8");

for (const token of [
  "nextTurnPending",
  "PENDING",
  "DISPATCHING",
  "dispatchNextTurnPendingIfSafe",
  "nextTurnAlreadyDelivered",
  "durableNextTurnRecovered",
  "Durable next turn"
]) assert.ok(background.includes(token),"missing next-turn durability token "+token);

assert.match(background,/payloadHash: await sha256Text\(outgoing\.text\)/);
assert.match(background,/await saveState\(\);\s*\n\s*await new Promise\(resolve => setTimeout\(resolve, state\.delayMs\)\);/);
assert.match(background,/if \(await nextTurnAlreadyDelivered\(pending\)\)/);
assert.match(background,/unresolved handoff state/);
assert.match(background,/Durable next-turn payload hash mismatch/);
assert.match(background,/state\.nextTurnPending = null;\s*\n\s*await saveState\(\);/);

console.log("AI Bridge durable next-turn recovery: OK");
