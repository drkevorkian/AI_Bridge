import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "dashboard-viewpoint-queue.js"), "utf8");

assert.match(src, /aria-live",\s*"polite"/,
  "queue badge must retain polite live-region semantics");
assert.match(src, /deduplicatesLiveText:\s*true/,
  "queue dashboard must advertise deduplicated live text updates");
assert.match(src, /if \(badge\.textContent !== text\) badge\.textContent = text;/,
  "queue live text must only mutate when the announced text actually changes");
assert.match(src, /if \(badge\.dataset\.phase !== phase\) badge\.dataset\.phase = phase;/,
  "queue phase state must avoid redundant DOM writes");
assert.match(src, /if \(badge\.hidden !== hidden\) badge\.hidden = hidden;/,
  "queue visibility state must avoid redundant DOM writes");
assert.doesNotMatch(src, /setInterval\s*\(/,
  "queue UI must continue reusing the established health cadence");
assert.doesNotMatch(src, /provenanceId|boundTabId|threadKey/,
  "queue UI must remain free of worker-only conversation identity");

console.log("viewpoint queue live-region dedup regression: ok");
