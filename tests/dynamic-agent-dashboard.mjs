import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const bootstrap = read("dashboard-bootstrap.js");
const dynamic = read("dashboard-dynamic-agents.js");
const css = read("dashboard-dynamic-agents.css");
const dashboard = read("dashboard.js");

assert.match(bootstrap, /dashboard-dynamic-agents\.js/);
assert.match(bootstrap, /dynamicAgentAdapter:\s*true/);
assert.match(dynamic, /\["A", "B", "C", "D", "E"\]/);
assert.match(dynamic, /AI_BRIDGE_SET_AGENT_COUNT/);
assert.match(dynamic, /AI_BRIDGE_ADAPTIVE_SELECT/);
assert.doesNotMatch(dynamic, /type:\s*"AI_BRIDGE_PROVIDER_HEALTH"/,
  "dashboard refresh must use the Adaptive Selector's returned health snapshot instead of a separate TOCTOU-prone health request");
assert.match(dynamic, /let healthRefreshEpoch = 0/);
assert.match(dynamic, /const refreshEpoch = \+\+healthRefreshEpoch/,
  "each dashboard health refresh must acquire a monotonically increasing UI commit token");
assert.match(dynamic, /if \(refreshEpoch !== healthRefreshEpoch\) return null/,
  "older overlapping health refreshes must not repaint newer dashboard state");
assert.match(dynamic, /applyHealth\(adaptive\.health\)/,
  "health rendering must use the exact snapshot returned with the Adaptive Selector recommendation");
assert.match(dynamic, /atomicHealthRecommendation:\s*true/);
assert.match(dynamic, /latestRefreshWins:\s*true/);
assert.match(dynamic, /selectedBindings\s*=\s*wrapped/);
assert.doesNotMatch(dynamic, /chrome\.runtime\.sendMessage\s*=\s*/,
  "dashboard adapter must not monkey-patch Chrome message transport");
assert.match(dynamic, /addEventListener\("click", event => \{/);
assert.match(dynamic, /stopImmediatePropagation\(\)/,
  "start guard should block unhealthy sessions before the legacy click handler runs");
assert.match(dynamic, /duplicateProviderAgentsEnabled:\s*true/,
  "dashboard diagnostics must reflect active same-provider viewpoint mode");
assert.match(dynamic, /forceFrom\$\{side\}/);
assert.match(dynamic, /forceTo\$\{side\}/);
assert.match(dynamic, /newChat\$\{side\}/);
assert.match(dynamic, /resend\$\{side\}/);
assert.match(dynamic, /useLast\$\{side\}/);
assert.match(dynamic, /timerTotal\$\{side\}/);
assert.match(dynamic, /timerCurrent\$\{side\}/);

// Slice 27 deliberately returns side:null when no provider is READY. The
// dashboard must preserve that fail-closed result instead of visually
// manufacturing AI A through a truthy fallback.
assert.match(dynamic, /function formatAdaptiveRecommendation\(adaptive\)/);
assert.match(dynamic, /Adaptive start: No READY target/);
assert.match(dynamic, /typeof side !== "string" \|\| !ALL_SIDES\.includes\(side\)/);
assert.doesNotMatch(dynamic, /adaptive\.recommendation\?\.side\s*\|\|\s*"A"/,
  "null Adaptive Selector recommendations must never be rendered as AI A");
assert.match(dynamic, /recommendation\.textContent = formatAdaptiveRecommendation\(adaptive\)/,
  "dashboard recommendation rendering must go through the null-safe formatter");

assert.match(css, /data-status="READY"/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /text-overflow:\s*ellipsis/,
  "long health labels should not stretch or break agent cards");
assert.match(css, /white-space:\s*nowrap/,
  "health labels should remain a single compact status line");
assert.match(css, /overflow-wrap:\s*anywhere/,
  "adaptive recommendation text should remain contained on narrow layouts");
assert.match(css, /--agent-d-accent:\s*color-mix/,
  "AI D should derive a theme-aware accent from the existing palette");
assert.match(css, /--agent-e-accent:\s*color-mix/,
  "AI E should derive a theme-aware accent from the existing palette");
assert.match(css, /\.agent-card\.agent-d\s*\{[^}]*border-left-color:\s*var\(--agent-d-accent\)/s,
  "AI D cards should be visually distinguishable");
assert.match(css, /\.agent-card\.agent-e\s*\{[^}]*border-left-color:\s*var\(--agent-e-accent\)/s,
  "AI E cards should be visually distinguishable");
assert.match(css, /\.transcript-card\.side-d\s*\{[^}]*var\(--agent-d-accent\)/s,
  "AI D transcript entries should retain their side identity");
assert.match(css, /\.transcript-card\.side-e\s*\{[^}]*var\(--agent-e-accent\)/s,
  "AI E transcript entries should retain their side identity");

// The legacy dashboard still defines the original A/B/C array; the adapter
// intentionally expands that mutable array after the page has initialized.
assert.match(dashboard, /const SIDES = \["A", "B", "C"\]/);
assert.match(dynamic, /SIDES\.splice\(0, SIDES\.length, \.\.\.next\)/);

console.log("dynamic-agent-dashboard: ok");
