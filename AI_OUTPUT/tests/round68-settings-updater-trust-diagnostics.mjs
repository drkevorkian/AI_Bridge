import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"..");
const js=fs.readFileSync(path.join(root,"runtime_review","settings.js"),"utf8");
const bg=fs.readFileSync(path.join(root,"runtime_review","background.js"),"utf8");

for(const token of [
  "minimumKeyBits:0,releaseReason:\"\"",
  "secureUpdater.minimumKeyBits=Number(verification.minimum_key_bits)||0;",
  "secureUpdater.releaseReason=String(verification.reason||\"\");",
  "secureUpdater.minimumKeyBits>0&&secureUpdater.keyBits>0&&secureUpdater.keyBits<secureUpdater.minimumKeyBits",
  "requires ≥",
  '$("automaticApplyStatus").textContent="Available";',
  'cp.phase==="CHECKPOINTED"?"Ready to apply":"In progress"'
]) assert.ok(js.includes(token),"Settings updater diagnostic missing "+token);

assert.doesNotMatch(
  js,
  /automaticApplyStatus"\)\.textContent="Ready";/,
  "idle updater capability must not be described as Ready"
);

for(const token of [
  "minimum_key_bits:minimumBits",
  "reason",
  "NATIVE_UPDATE_RELEASE_TRUST_INVALID",
  "NATIVE_UPDATE_RELEASE_TRUST_CONTRADICTORY"
]) assert.ok(bg.includes(token),"background normalized trust contract missing "+token);

const invalidStart=js.indexOf("}else if(!secureUpdater.releaseReady){");
const readyStart=js.indexOf("}else{",invalidStart+1);
assert.ok(invalidStart>=0&&readyStart>invalidStart,"invalid release-trust render block missing");
const invalidBlock=js.slice(invalidStart,readyStart);
assert.ok(invalidBlock.includes('"Invalid configuration"'),"invalid release trust must be labeled explicitly");
assert.ok(invalidBlock.includes('secureUpdater.minimumKeyBits'),"invalid release trust must display the minimum key floor");

console.log("round68-settings-updater-trust-diagnostics: PASS");
