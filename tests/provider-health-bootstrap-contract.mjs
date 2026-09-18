import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const wrapper = read("background-wrapper.js");
const health = read("provider-health-runtime.js");

for (const capability of [
  "stateKeyedProbeCache",
  "tabLifecycleInvalidatesProbeCache",
  "rejectsUnstableInflightProbes"
]) {
  assert.match(
    health,
    new RegExp(`${capability}:\\s*true`),
    `Provider Health runtime must expose ${capability}`
  );
  assert.match(
    wrapper,
    new RegExp(`__AI_BRIDGE_PROVIDER_HEALTH_V1__\\?\\.${capability}\\s*!==\\s*true`),
    `service-worker bootstrap must fail closed when ${capability} is missing`
  );
}

assert.match(wrapper, /mutatesRouting\s*!==\s*false/,
  "Provider Health must remain read-only at bootstrap");
assert.match(wrapper, /sendsProviderPrompts\s*!==\s*false/,
  "Provider Health must remain non-dispatching at bootstrap");

console.log("provider-health-bootstrap-contract: ok");
