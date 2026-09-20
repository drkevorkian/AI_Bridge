import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const review = path.join(here, "../runtime_review");
const dashboard = fs.readFileSync(path.join(review, "dashboard.css"), "utf8");
const layouts = fs.readFileSync(path.join(review, "dashboard-layouts.css"), "utf8");

assert.match(
  dashboard,
  /@media\s*\(max-width:\s*1100px\)\s*\{[\s\S]*?body\s*\{\s*min-width:\s*760px;\s*\}/,
  "901–1100px desktop floor must remain 760px"
);

assert.match(
  dashboard,
  /@media\s*\(max-width:\s*900px\)\s*\{[\s\S]*?body\s*\{\s*min-width:\s*0;\s*\}/,
  "≤900px must remove the desktop body minimum"
);

assert.match(
  layouts,
  /@media\s*\(max-width:900px\)\s*\{[\s\S]*?html\[data-layout="classic"\]\s+\.app-shell\s*\{\s*grid-template-columns:1fr\s*\}/,
  "Classic must stack to one column at the same 900px breakpoint"
);

assert.match(
  layouts,
  /@media\s*\(max-width:900px\)[\s\S]*?\.pane-splitter\s*\{\s*display:none\s*\}/,
  "splitter must disappear in stacked Classic mode"
);

assert.doesNotMatch(
  dashboard,
  /@media\s*\(max-width:\s*900px\)[\s\S]{0,500}?min-width:\s*(?:480|760|960)px/,
  "narrow Classic mode must not restore a fixed desktop body floor"
);

console.log("round50-responsive-classic-layout: PASS");
