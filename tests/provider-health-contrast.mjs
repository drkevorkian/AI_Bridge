import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(root, "dashboard-dynamic-agents.css"), "utf8");

const healthRule = css.match(/\.dynamic-health-badge\s*\{([^}]*)\}/s);
assert.ok(healthRule, "dynamic health badge rule must exist");
assert.match(healthRule[1], /opacity:\s*1\s*;/,
  "health status text must remain fully opaque so theme contrast is not weakened");
assert.doesNotMatch(healthRule[1], /opacity:\s*0\.[0-9]+\s*;/,
  "health status text must not use fractional opacity that can break contrast in light themes");
assert.match(css, /\.dynamic-health-badge\s+\.status-label\s*\{[^}]*white-space:\s*nowrap/s,
  "health states must continue to provide a textual, non-color status label");

// `.agent-card-queue-badge {` appears both as the second selector in the shared
// thread/queue layout rule and as its own operational-status rule. Enumerate all
// occurrences so this regression verifies the actual opacity contract without
// depending on comments or formatting between CSS blocks.
const queueRules = [...css.matchAll(/\.agent-card-queue-badge\s*\{([^}]*)\}/gs)].map(match => match[1]);
assert.ok(queueRules.length >= 1, "queue status badge rule must exist");
assert.ok(queueRules.some(body => /opacity:\s*1\s*;/.test(body)),
  "queued and sending states must stay fully opaque so operational status keeps theme contrast");
assert.equal(queueRules.some(body => /opacity:\s*0\.[0-9]+\s*;/.test(body)), false,
  "queue status rules must not use fractional opacity that can reduce readability");

const threadRule = css.match(/\.agent-card-thread-badge\s*\{([^}]*)\}/s);
assert.ok(threadRule, "thread identity badge rule must remain separate from queue status styling");
assert.match(threadRule[1], /opacity:\s*0\.72\s*;/,
  "secondary viewpoint identity may remain visually subdued without weakening live queue status");

console.log("provider health and queue contrast regression: ok");
