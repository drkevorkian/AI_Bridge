import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const hardening = fs.readFileSync(path.join(root, "content-response-delivery-hardening.js"), "utf8");

assert.match(content, /async function monitor\(/, "content.js must include monitor()");
assert.match(content, /chrome\.runtime\.sendMessage\(\{[\s\S]*type:\s*"AI_BRIDGE_RESPONSE"/, "content.js must report completed responses");
assert.match(hardening, /const inFlight = new Map\(\)/, "delivery hardening must deduplicate in-flight response sends");
assert.match(hardening, /INITIAL_RETRY_MS\s*=\s*250/, "delivery hardening must retry transient failures");
assert.match(hardening, /extension context invalidated/i, "delivery hardening must stop retrying invalidated content contexts");
assert.match(hardening, /settled = new Map\(\)/, "delivery hardening must remember acknowledgements");
assert.match(hardening, /supersedeOlder\(/, "delivery hardening must prevent stale response delivery from overtaking newer DOM state");

console.log("v1.16.3 response delivery regression passed");
