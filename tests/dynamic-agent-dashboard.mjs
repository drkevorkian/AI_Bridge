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
assert.match(dynamic, /AI_BRIDGE_PROVIDER_HEALTH/);
assert.match(dynamic, /AI_BRIDGE_ADAPTIVE_SELECT/);
assert.match(dynamic, /selectedBindings\s*=\s*wrapped/);
assert.doesNotMatch(dynamic, /chrome\.runtime\.sendMessage\s*=\s*/,
  "dashboard adapter must not monkey-patch Chrome message transport");
assert.match(dynamic, /addEventListener\("click", event => \{/);
assert.match(dynamic, /stopImmediatePropagation\(\)/,
  "start guard should block unhealthy sessions before the legacy click handler runs");
assert.match(dynamic, /duplicateProviderAgentsEnabled:\s*false/);
assert.match(dynamic, /forceFrom\$\{side\}/);
assert.match(dynamic, /forceTo\$\{side\}/);
assert.match(dynamic, /newChat\$\{side\}/);
assert.match(dynamic, /resend\$\{side\}/);
assert.match(dynamic, /useLast\$\{side\}/);
assert.match(dynamic, /timerTotal\$\{side\}/);
assert.match(dynamic, /timerCurrent\$\{side\}/);
assert.match(css, /data-status="READY"/);
assert.match(css, /prefers-reduced-motion/);

// The legacy dashboard still defines the original A/B/C array; the adapter
// intentionally expands that mutable array after the page has initialized.
assert.match(dashboard, /const SIDES = \["A", "B", "C"\]/);
assert.match(dynamic, /SIDES\.splice\(0, SIDES\.length, \.\.\.next\)/);

console.log("dynamic-agent-dashboard: ok");
