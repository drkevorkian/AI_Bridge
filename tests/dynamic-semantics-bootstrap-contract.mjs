import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrapper = fs.readFileSync(path.join(root, "background-wrapper.js"), "utf8");
const semantics = fs.readFileSync(path.join(root, "coordinator-dynamic-semantics.js"), "utf8");

// The service-worker bootstrap must accept the exact diagnostic contract exposed
// by the dynamic semantics overlay. A version/marker mismatch makes the whole
// extension fail closed at startup, so keep this coupling explicit and tested.
const runtimeVersion = semantics.match(/globalThis\[FLAG\]\s*=\s*Object\.freeze\(\{[\s\S]*?version:\s*(\d+)/)?.[1];
assert.ok(runtimeVersion, "dynamic semantics runtime must expose a diagnostic version");
assert.match(
  wrapper,
  new RegExp(`__AI_BRIDGE_DYNAMIC_SEMANTICS_V1__\\?\\.version !== ${runtimeVersion}`),
  "background bootstrap must require the current dynamic semantics version"
);
assert.match(
  wrapper,
  /__AI_BRIDGE_DYNAMIC_SEMANTICS_V1__\?\.liveRosterMeshTargets !== true/,
  "background bootstrap must require live-roster Mesh target support"
);
assert.match(
  semantics,
  /liveRosterMeshTargets:\s*true/,
  "dynamic semantics runtime must advertise live-roster Mesh target support"
);
assert.match(
  wrapper,
  /__AI_BRIDGE_DYNAMIC_SEMANTICS_V1__\?\.cloudJobWritesThroughRosterAdapter !== true/,
  "background bootstrap must require adapter-backed cloud job writes"
);
assert.match(
  semantics,
  /cloudJobWritesThroughRosterAdapter:\s*true/,
  "dynamic semantics runtime must advertise adapter-backed cloud job writes"
);

console.log("dynamic-semantics-bootstrap-contract: ok");
