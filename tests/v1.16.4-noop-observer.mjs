import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const completionGuard = fs.readFileSync(path.join(root, "content-completion-guard.js"), "utf8");

assert.doesNotMatch(
  content,
  /new\s+MutationObserver\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/,
  "content.js must not subscribe to the whole provider DOM with an empty MutationObserver callback"
);
assert.match(
  content,
  /setInterval\(monitor,\s*650\)/,
  "response polling remains the intentional content.js monitor trigger"
);
assert.match(
  completionGuard,
  /new\s+MutationObserver/,
  "the functional completion-guard MutationObserver must remain intact"
);

console.log("v1.16.4 no-op MutationObserver regression passed.");
