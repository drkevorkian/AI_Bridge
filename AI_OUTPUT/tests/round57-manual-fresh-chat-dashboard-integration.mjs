import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const review = path.join(here, "../runtime_review");
const dashboard = fs.readFileSync(path.join(review, "dashboard.js"), "utf8");
const html = fs.readFileSync(path.join(review, "dashboard.html"), "utf8");
const background = fs.readFileSync(path.join(review, "background.js"), "utf8");

const openStart = dashboard.indexOf("async function openFreshChats(rawSides)");
const openEnd = dashboard.indexOf("async function clearHistory", openStart);
assert.ok(openStart >= 0 && openEnd > openStart, "openFreshChats implementation missing");
const openFresh = dashboard.slice(openStart, openEnd);

for (const token of [
  'type: "AI_BRIDGE_NEW_CHATS"',
  "sides: requested,",
  "...selectedBindings()",
  "latestState?.sessionActive",
  "Stop the current Bridge session before opening fresh AI chats manually.",
  "Fresh chat verified for"
]) {
  assert.ok(openFresh.includes(token), "manual fresh-chat UI path missing " + token);
}

assert.doesNotMatch(
  openFresh,
  /New Chat is LIMITED/,
  "Dashboard must not retain the old manual-New-Chat stub"
);

const controlsStart = dashboard.indexOf("function updateControls(s)");
const controlsEnd = dashboard.indexOf("function runtimePhaseLabel", controlsStart);
assert.ok(controlsStart >= 0 && controlsEnd > controlsStart, "updateControls block missing");
const controls = dashboard.slice(controlsStart, controlsEnd);

for (const token of [
  "const manualFreshAllowed = !s.sessionActive;",
  "const activeTabsValid = validateActiveTabs() === null;",
  '$("newAllChats").disabled = !manualFreshAllowed || !activeTabsValid;',
  '$("freshOnStart").disabled = !manualFreshAllowed || !activeTabsValid;',
  "const manualTabReady = Number.isInteger(tabId) && tabId > 0 && tabsById.has(tabId);",
  '$(`newChat${side}`).disabled = !manualFreshAllowed || !manualTabReady;'
]) {
  assert.ok(controls.includes(token), "manual fresh-chat control policy missing " + token);
}

assert.doesNotMatch(
  dashboard,
  /freshOnStart"\)\.checked\s*=\s*false/,
  "Dashboard must not silently clear the human's fresh-on-start choice"
);

assert.ok(
  dashboard.includes('freshChats: $("freshOnStart").checked'),
  "Start request must carry the fresh-on-start choice"
);

for (const side of ["A", "B", "C", "D", "E"]) {
  assert.match(
    html,
    new RegExp('id="newChat' + side + '"[^>]*>New chat<\\/button>'),
    "AI " + side + " fresh-chat button must be exposed"
  );
}
assert.match(html, />New AI chats<\/button>/, "bulk fresh-chat control missing");
assert.match(html, /<span>Start in fresh AI chats<\/span>/, "fresh-on-start control missing");
assert.doesNotMatch(html, /Manual unavailable/, "working fresh-chat controls must not be labeled unavailable");
assert.equal((html.match(/Rollover: Checking/g) || []).length, 5, "bootstrap health should be neutral while provider health loads");

assert.ok(
  background.includes('if (msg.type === "AI_BRIDGE_NEW_CHATS")'),
  "background manual fresh-chat endpoint missing"
);
assert.ok(
  background.includes("const resetSides = await resetSelectedChats(msg, sides);"),
  "manual fresh-chat endpoint must use trusted resetSelectedChats path"
);
assert.ok(
  background.includes('throw new Error("Stop the current bridge session before opening fresh AI chats.")'),
  "backend must reject ordinary manual reset during a saved session"
);
assert.ok(
  background.includes("await resetSelectedChats(selected, SIDES, { allowActive: true });"),
  "Start-with-fresh-chats must reuse the same trusted reset path"
);

console.log("round57-manual-fresh-chat-dashboard-integration: PASS");
