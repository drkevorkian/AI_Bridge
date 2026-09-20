import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(here, "../runtime_review/dashboard.css"), "utf8");

const narrow = css.match(/@media\s*\(max-width:\s*600px\)\s*\{([\s\S]*?)\n\}/);
assert.ok(narrow, "missing ≤600px narrow-header breakpoint");
const block = narrow[1];

for (const selector of [".agent-topline", ".transcript-head", ".workspace-header"]) {
  assert.ok(block.includes(selector), selector + " must participate in narrow wrapping");
}
assert.match(block, /flex-wrap:\s*wrap;/, "narrow header/action rows must wrap");
assert.match(block, /align-items:\s*flex-start;/, "wrapped headers must align safely from the top");

for (const selector of [".agent-identity", ".transcript-title"]) {
  assert.ok(block.includes(selector), selector + " must be width-constrained");
}
assert.match(block, /min-width:\s*0;/, "narrow identities/titles need min-width:0");
assert.match(block, /max-width:\s*100%;/, "narrow identities/titles need max-width:100%");
assert.match(block, /\.transcript-title\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/, "long transcript titles must wrap anywhere");
assert.match(block, /\.transcript-meta\s*\{[\s\S]*?white-space:\s*normal;/, "transcript metadata must be allowed to wrap");

for (const selector of [".agent-actions", ".workspace-actions"]) {
  assert.ok(block.includes(selector), selector + " must wrap at narrow widths");
}

assert.match(
  css,
  /@media\s*\(max-width:\s*480px\)\s*\{[\s\S]*?\.human-modal-actions\s*\{[\s\S]*?grid-template-columns:\s*1fr;/,
  "human modal actions must stack below 480px"
);

console.log("round53-narrow-header-wrapping: PASS");
