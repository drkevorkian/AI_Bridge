import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "dashboard-dynamic-validation.js"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "dashboard-bootstrap.js"), "utf8");

assert.match(bootstrap, /dashboard-dynamic-validation\.js/,
  "bootstrap should load dynamic dashboard tab validation");
assert.match(bootstrap, /dynamicTabValidationAdapter:\s*true/,
  "bootstrap diagnostics should report the validation adapter");
assert.match(source, /typeof validateThreeTabs === "function"/,
  "adapter should replace the legacy validator only when it exists");
assert.match(source, /new Set\(ids\)\.size !== ids\.length/,
  "duplicate-tab validation must compare against the live roster size");
assert.doesNotMatch(source, /new Set\(ids\)\.size !== 3/,
  "dynamic validation must not reintroduce the fixed-three defect");

const tabBySide = new Map();
const context = vm.createContext({
  console,
  SIDES: ["A", "B", "C", "D", "E"],
  selectedTab(side) { return tabBySide.get(side) ?? null; },
  validateThreeTabs() { return "legacy validator still active"; }
});
context.window = context;
vm.runInContext(source, context, { filename: "dashboard-dynamic-validation.js" });

assert.equal(context.__AI_BRIDGE_DYNAMIC_TAB_VALIDATION__.dynamicAgentCount, true,
  "adapter should expose dynamic-count diagnostics");
assert.equal(context.__AI_BRIDGE_DYNAMIC_TAB_VALIDATION__.uniquePhysicalTabsRequired, true,
  "adapter should preserve unique physical tab enforcement");

function bindUnique(sides) {
  tabBySide.clear();
  sides.forEach((side, index) => tabBySide.set(side, 100 + index));
  context.SIDES.splice(0, context.SIDES.length, ...sides);
}

for (const sides of [
  ["A"],
  ["A", "B"],
  ["A", "B", "C"],
  ["A", "B", "C", "D"],
  ["A", "B", "C", "D", "E"]
]) {
  bindUnique(sides);
  assert.equal(context.validateThreeTabs(), null,
    `${sides.length} unique selected tab(s) should pass dynamic validation`);
}

bindUnique(["A", "B", "C", "D", "E"]);
tabBySide.set("E", tabBySide.get("A"));
assert.match(context.validateThreeTabs(), /different tabs/i,
  "five-agent validation must still reject a duplicated physical tab");

bindUnique(["A", "B", "C", "D"]);
tabBySide.delete("D");
assert.equal(context.validateThreeTabs(), "Choose 4 supported AI tabs.",
  "missing bindings should report the live roster count");

bindUnique(["A"]);
tabBySide.delete("A");
assert.equal(context.validateThreeTabs(), "Choose 1 supported AI tab.",
  "single-agent mode should use singular validation copy");

console.log("dynamic-dashboard-validation: ok");
