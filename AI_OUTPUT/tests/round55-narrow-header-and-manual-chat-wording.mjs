import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(here, "../runtime_review/dashboard.css"), "utf8");
const html = fs.readFileSync(path.join(here, "../runtime_review/dashboard.html"), "utf8");

const narrowStart = css.indexOf("@media (max-width: 600px)");
const modalStart = css.indexOf("@media (max-width: 480px)", narrowStart + 1);
assert.ok(narrowStart >= 0 && modalStart > narrowStart, "narrow responsive boundaries missing");
const narrow = css.slice(narrowStart, modalStart);

assert.match(
  narrow,
  /\.workspace-header\s*\{[\s\S]*?height:\s*auto;[\s\S]*?min-height:\s*82px;/,
  "wrapped workspace header must be allowed to expand while preserving the desktop visual floor"
);

assert.doesNotMatch(
  html,
  /Trusted automatic New Chat authority is not available yet\./,
  "manual controls must not claim automatic rollover is unavailable"
);

assert.equal(
  (html.match(/New chat — Manual unavailable/g) || []).length,
  5,
  "all five per-agent manual New Chat controls must be labeled accurately"
);

assert.equal(
  (html.match(/Manual New Chat is unavailable from this control\. Automatic rollover remains available/g) || []).length,
  6,
  "all disabled manual New Chat buttons must explain that automatic rollover remains available"
);

assert.match(html, /New AI chats — Manual unavailable/, "bulk manual New Chat wording missing");
assert.match(html, /Start in fresh AI chats — Manual unavailable/, "fresh-on-start manual wording missing");

console.log("round55-narrow-header-and-manual-chat-wording: PASS");
