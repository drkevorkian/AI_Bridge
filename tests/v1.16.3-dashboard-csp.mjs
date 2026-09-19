import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "dashboard.html"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "dashboard-bootstrap.js"), "utf8");

const scriptTags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
for (const match of scriptTags) {
  const attrs = match[1] || "";
  const body = (match[2] || "").trim();
  assert.match(attrs, /\bsrc\s*=\s*["'][^"']+["']/i, "every dashboard script must load a packaged file");
  assert.equal(body, "", "dashboard.html must not contain inline JavaScript under MV3 CSP");
}

assert.match(html, /<script\s+src=["']dashboard-bootstrap\.js["']><\/script>/i);
assert.match(bootstrap, /localStorage\.getItem\(["']aiBridgeLayoutHint["']\)/);
assert.match(bootstrap, /document\.documentElement\.dataset\.layout/);

console.log("v1.16.3 dashboard CSP regression checks passed.");
