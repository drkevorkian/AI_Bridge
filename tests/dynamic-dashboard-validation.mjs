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
assert.match(source, /dynamicFreshChatValidation:\s*true/,
  "adapter should report full-roster fresh-chat validation");

const tabBySide = new Map();
const status = { textContent: "" };
const newAllChats = { textContent: "New all chats", disabled: false };
const elements = new Map([
  ["status", status],
  ["newAllChats", newAllChats]
]);
const freshChatCalls = [];
const context = vm.createContext({
  console,
  SIDES: ["A", "B", "C", "D", "E"],
  selectedTab(side) { return tabBySide.get(side) ?? null; },
  validateThreeTabs() { return "legacy validator still active"; },
  async openFreshChats(sides) {
    freshChatCalls.push(Array.isArray(sides) ? [...sides] : sides);
    return "opened";
  },
  document: {
    getElementById(id) { return elements.get(id) ?? null; }
  }
});
context.window = context;
vm.runInContext(source, context, { filename: "dashboard-dynamic-validation.js" });

assert.equal(context.__AI_BRIDGE_DYNAMIC_TAB_VALIDATION__.dynamicAgentCount, true,
  "adapter should expose dynamic-count diagnostics");
assert.equal(context.__AI_BRIDGE_DYNAMIC_TAB_VALIDATION__.uniquePhysicalTabsRequired, true,
  "adapter should preserve unique physical tab enforcement");
assert.equal(context.__AI_BRIDGE_DYNAMIC_TAB_VALIDATION__.dynamicFreshChatValidation, true,
  "adapter should expose fresh-chat validation diagnostics");

function bindUnique(sides) {
  tabBySide.clear();
  sides.forEach((side, index) => tabBySide.set(side, 100 + index));
  context.SIDES.splice(0, context.SIDES.length, ...sides);
  status.textContent = "";
  newAllChats.textContent = "New all chats";
  newAllChats.disabled = false;
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

// Full-roster fresh-chat calls outside the legacy 3-agent case must get the
// same early validation and busy-state semantics instead of bypassing them.
bindUnique(["A", "B", "C", "D", "E"]);
freshChatCalls.length = 0;
assert.equal(await context.openFreshChats(["A", "B", "C", "D", "E"]), "opened");
assert.deepEqual(freshChatCalls, [["A", "B", "C", "D", "E"]],
  "five-agent New all should reach the existing fresh-chat implementation once");
assert.equal(newAllChats.textContent, "New all chats",
  "shared New all label should be restored after a five-agent reset");
assert.equal(newAllChats.disabled, false,
  "shared New all disabled state should be restored after a five-agent reset");

bindUnique(["A", "B", "C", "D", "E"]);
tabBySide.delete("E");
freshChatCalls.length = 0;
await context.openFreshChats(["A", "B", "C", "D", "E"]);
assert.equal(freshChatCalls.length, 0,
  "five-agent New all should fail before dispatch when a binding is missing");
assert.equal(status.textContent, "Choose 5 supported AI tabs.",
  "five-agent New all should surface roster-aware validation copy");

bindUnique(["A", "B", "C", "D"]);
tabBySide.set("D", tabBySide.get("A"));
freshChatCalls.length = 0;
await context.openFreshChats(["A", "B", "C", "D"]);
assert.equal(freshChatCalls.length, 0,
  "four-agent New all should fail before dispatch on duplicate physical tabs");
assert.match(status.textContent, /different tabs/i,
  "four-agent New all should preserve duplicate-tab rejection");

bindUnique(["A", "B", "C", "D", "E"]);
freshChatCalls.length = 0;
assert.equal(await context.openFreshChats(["D"]), "opened");
assert.deepEqual(freshChatCalls, [["D"]],
  "single-side New chat must continue to use the legacy path unchanged");

console.log("dynamic-dashboard-validation: ok");
