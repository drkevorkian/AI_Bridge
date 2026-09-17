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

console.log("provider health contrast regression: ok");
