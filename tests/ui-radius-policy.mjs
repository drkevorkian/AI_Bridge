import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");
const cssFiles = ["dashboard.css", "dashboard-layouts.css", "popup.css", "settings.css"];

for (const rel of cssFiles) {
  const css = read(rel);
  for (const match of css.matchAll(/--radius-[a-z-]+\\s*:\\s*([0-9.]+)px\\s*;/gi)) {
    const value = Number(match[1]);
    assert.ok(Number.isFinite(value) && value <= 8, rel + ": radius token exceeds 8px: " + match[0]);
  }
  for (const match of css.matchAll(/border-radius\\s*:\\s*([^;]+);/gi)) {
    const value = match[1].trim();
    if (value === "0" || value === "0px") continue;
    if (/^var\\(--radius-(?:sm|base|lg)\\)$/.test(value)) continue;
    const px = value.match(/^([0-9.]+)px$/i);
    if (px) {
      assert.ok(Number(px[1]) <= 8, rel + ": border-radius exceeds 8px: " + value);
      continue;
    }
    assert.fail(rel + ": unsupported border-radius value: " + value);
  }
  assert.doesNotMatch(css, /border-radius\\s*:\\s*[^;]*(?:%|999)/i, rel + ": pill/circle-style radius is not allowed");
}

for (const rel of ["dashboard.js", "dashboard-layouts.js", "popup.js", "settings.js"]) {
  const js = read(rel);
  assert.doesNotMatch(js, /borderRadius\\s*=\\s*["\'][^"\']+["\']/, rel + ": runtime borderRadius assignment bypasses CSS policy");
}

console.log("AI Bridge UI radius policy: OK");
