import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set([".git", "node_modules", ".venv", "venv", "dist", "build"]);

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function runNode(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
  }
}

const allFiles = walk(root);
const syntaxTargets = allFiles
  .filter(file => /\.(?:js|mjs)$/i.test(file))
  .sort((a, b) => a.localeCompare(b));

for (const file of syntaxTargets) {
  const relative = path.relative(root, file);
  runNode(["--check", relative], `Syntax check: ${relative}`);
}

const regressionTests = allFiles
  .filter(file => path.dirname(file) === path.join(root, "tests"))
  .filter(file => file.endsWith(".mjs"))
  .filter(file => path.basename(file) !== "run-all.mjs")
  .sort((a, b) => a.localeCompare(b));

for (const test of regressionTests) {
  const relative = path.relative(root, test);
  console.log(`\n=== ${relative} ===`);
  runNode([relative], `Regression: ${relative}`);
}

console.log(`\nAI Bridge regression suite passed: ${syntaxTargets.length} syntax checks, ${regressionTests.length} regression files.`);
