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

assert.doesNotMatch(html, /Manual unavailable/, "working manual fresh-chat controls must not be labeled unavailable");
assert.doesNotMatch(
  html,
  /Trusted automatic New Chat authority is not available yet\./,
  "manual controls must not claim automatic rollover is unavailable"
);

for (const side of ["A", "B", "C", "D", "E"]) {
  assert.match(
    html,
    new RegExp('id="newChat' + side + '"[^>]*>New chat<\\/button>'),
    "AI " + side + " manual fresh-chat control must be exposed"
  );
}

assert.equal(
  (html.match(/Open a fresh verified provider chat for this AI/g) || []).length,
  5,
  "all five per-agent New Chat controls must describe verified fresh-chat behavior"
);
assert.match(html, />New AI chats<\/button>/, "bulk New Chat control must be exposed");
assert.match(html, /<span>Start in fresh AI chats<\/span>/, "fresh-on-start option must be exposed");
assert.equal(
  (html.match(/Rollover: Checking/g) || []).length,
  5,
  "initial provider-health rows should use neutral rollover checking state"
);

console.log("round55-narrow-header-and-manual-chat-wording: PASS");
