import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const review = path.join(here, "../runtime_review");

const files = ["dashboard.css", "popup.css", "settings.css"];
const allowed = new Set([
  "0",
  "50%",
  "var(--radius-sm)",
  "var(--radius-md)",
  "var(--radius-lg)",
  "var(--radius-xl)"
]);

for (const name of files) {
  const css = fs.readFileSync(path.join(review, name), "utf8");

  assert.ok(
    css.includes("--radius-sm: 4px") || css.includes("--radius-sm:4px"),
    name + ": missing 4px radius token"
  );
  assert.ok(
    css.includes("--radius-md: 6px") || css.includes("--radius-md:6px"),
    name + ": missing 6px radius token"
  );
  assert.ok(
    css.includes("--radius-lg: 8px") || css.includes("--radius-lg:8px"),
    name + ": missing 8px radius token"
  );
  assert.ok(
    css.includes("--radius-xl: 10px") || css.includes("--radius-xl:10px"),
    name + ": missing 10px radius token"
  );

  assert.doesNotMatch(css, /border-radius\s*:\s*999px/i, name + ": capsule radius restored");

  const radii = [...css.matchAll(/border-radius\s*:\s*([^;}]+)/gi)].map(match => match[1].trim());
  for (const radius of radii) {
    assert.ok(allowed.has(radius), name + ": unapproved radius " + radius);
  }

  assert.match(
    css,
    /data-theme=["']terminal["'][\s\S]*?border-radius\s*:\s*0/,
    name + ": Terminal square-corner override missing"
  );
}

const dashboard = fs.readFileSync(path.join(review, "dashboard.css"), "utf8");
const circles = [...dashboard.matchAll(/border-radius\s*:\s*50%/gi)];
assert.equal(circles.length, 1, "dashboard must contain exactly one semantic circle");
assert.match(
  dashboard,
  /\.human-modal-pulse\s*\{[^}]*border-radius\s*:\s*50%/s,
  "human-modal-pulse must remain the sole semantic circle"
);

for (const name of ["popup.css", "settings.css"]) {
  const css = fs.readFileSync(path.join(review, name), "utf8");
  assert.doesNotMatch(css, /border-radius\s*:\s*50%/i, name + ": unexpected circle");
}

console.log("round46-radius-normalization: PASS");
