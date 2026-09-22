import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const manifest=JSON.parse(fs.readFileSync(path.join(root,"manifest.json"),"utf8"));
const content=fs.readFileSync(path.join(root,"content.js"),"utf8");
const background=fs.readFileSync(path.join(root,"background.js"),"utf8");

const scripts=manifest.content_scripts?.[0]?.js||[];
assert.deepEqual(scripts.slice(0,3),["dom-resilience.js","provider-limit-signatures.js","content.js"]);
assert.match(content,/function inspectThreadLimit\(/);
assert.match(content,/AI_BRIDGE_THREAD_LIMIT/);
assert.match(content,/result\.state !== "HARD_THREAD_LIMIT"/);
assert.match(background,/msg\.type === "AI_BRIDGE_THREAD_LIMIT"/);
assert.match(background,/const rollover = await performThreadRollover\(side,/,
  "verified hard limits must hand off only to the dedicated rollover transaction");
assert.match(background,/String\(msg\.state \|\| ""\) !== "HARD_THREAD_LIMIT"/,
  "background must still reject non-hard-limit events");
assert.match(background,/providerCode: "HARD_THREAD_LIMIT"/);

console.log("AI Bridge thread-limit detection integration: OK");
