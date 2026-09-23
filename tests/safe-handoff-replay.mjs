import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const background=fs.readFileSync(path.join(root,"background.js"),"utf8");

assert.match(background,/payloadText: String\(text \|\| ""\)/);
assert.match(background,/Prepared handoff to AI .* was never attempted and can be safely replayed on Resume/);
assert.match(background,/async function replayPreparedHandoffIfSafe\(\)/);
assert.match(background,/String\(pending\.status \|\| ""\) !== "PREPARED"/);
assert.match(background,/Prepared handoff payload hash mismatch/);
assert.match(background,/Safely replayed never-attempted handoff/);
assert.match(background,/safeHandoffReplay/);
assert.match(background,/ambiguous send outcome\. Use recovery controls; Resume will not resend it/);
assert.match(background,/\["ACTION_ATTEMPTED", "FALLBACK_ACTION_ATTEMPTED", "AMBIGUOUS"\]/);

console.log("AI Bridge safe handoff replay: OK");
