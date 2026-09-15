import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const html = fs.readFileSync(path.join(root, "dashboard.html"), "utf8");
const css = fs.readFileSync(path.join(root, "dashboard.css"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

assert.ok(String(manifest.version || "").length > 0);
assert.match(css, /data-theme="blizzard"/);
assert.match(css, /data-theme="ghostwhite"/);
assert.match(css, /#ace5ee/);
assert.match(css, /#0a3a44/);
assert.match(css, /#1e293b/);
assert.match(css, /--control-pane-width:\s*40%/);
assert.match(html, /id="humanModal"/);
assert.match(html, /id="suppressHumanModal"/);
assert.match(html, /id="interjectNow"/);
const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
assert.equal(ids.length, new Set(ids).size, `duplicate ids: ${ids}`);

function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} missing`);
  const sigEnd = src.indexOf(")", start);
  let depth = 0;
  let i = src.indexOf("{", sigEnd);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`${name} unclosed`);
}

const sandbox = {};
vm.runInNewContext(
  `${extractFunction(background, "cleanHumanSignalLine")}\n${extractFunction(background, "extractHumanRequest")}\nthis.extractHumanRequest = extractHumanRequest;`,
  sandbox
);
const extractHumanRequest = sandbox.extractHumanRequest;

assert.equal(extractHumanRequest("Done.\n[[HUMAN_INPUT: pick the engine]]"), "pick the engine");
assert.equal(extractHumanRequest("Done.\n**[[HUMAN_INPUT: pick the engine]]**"), "pick the engine");
assert.equal(extractHumanRequest("I cannot continue without the target OS."), "I cannot continue without the target OS.");
assert.equal(extractHumanRequest("Would you like me to make a chart?"), null);
assert.ok(extractHumanRequest("Please choose the dataset before I continue."));

function stripProviderChrome(text) {
  return String(text || "")
    .replace(/^\s*(Gemini said|Gemini|Model response|Response)\s*[:\-–]?\s*/i, "")
    .replace(/^(Gemini said|Gemini)\s*$/gim, "")
    .trim();
}
function isLabelOnlyStub(text) {
  return /^(gemini said|gemini|model response|response|assistant)\.?$/i.test(String(text || "").trim());
}
function visibleText(node) {
  return String(node?.innerText || node?.textContent || "").replace(/\u00a0/g, " ").trim();
}
function extractGeminiText(root) {
  if (!root) return "";
  let best = "";
  const seen = new Set();
  const consider = el => {
    if (!el || seen.has(el)) return;
    seen.add(el);
    const text = stripProviderChrome(visibleText(el));
    if (!text || isLabelOnlyStub(text)) return;
    if (text.length > best.length) best = text;
  };
  for (const child of root.children || []) consider(child);
  consider(root);
  return best;
}

const stub = { innerText: "Gemini said", children: [] };
assert.equal(extractGeminiText(stub), "");
assert.equal(true, isLabelOnlyStub("Gemini said"));
const rich = {
  innerText: "Gemini said\nThe K4 still wins on price.\nKeep reliability weighted.",
  children: [
    { innerText: "Gemini said" },
    { innerText: "The K4 still wins on price.\nKeep reliability weighted." }
  ]
};
assert.match(extractGeminiText(rich), /K4 still wins/);
assert.ok(!extractGeminiText(rich).startsWith("Gemini said"));
assert.match(content, /4200/);
assert.match(content, /__AI_BRIDGE_LOADED_V114__/);
assert.match(background, /AI_BRIDGE_INTERJECT/);
assert.match(background, /AI_BRIDGE_HUMAN_SUPPRESS/);
console.log("v1.10 regression ok");
