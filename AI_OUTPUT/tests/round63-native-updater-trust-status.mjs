import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"..");
const host=fs.readFileSync(path.join(root,"update_system","native_host.py"),"utf8");
const readme=fs.readFileSync(path.join(root,"update_system","README.md"),"utf8");
const manifest=JSON.parse(fs.readFileSync(path.join(root,"runtime_review","manifest.json"),"utf8"));

for(const token of [
  "PINNED_RELEASE_RSA_N_HEX",
  "PINNED_RELEASE_RSA_E",
  "def _release_verification_status()",
  '"configured": configured',
  '"ready": syntactically_valid',
  '"algorithm": "RSA-PKCS1-v1_5-SHA256"',
  '"key_bits": key_bits',
  '"release_verification": _release_verification_status()'
]) assert.ok(host.includes(token),"native host missing "+token);

assert.ok(host.indexOf('"release_verification": _release_verification_status()') > host.indexOf('if command == "PING":'));
assert.doesNotMatch(host,/release_verification.*PINNED_RELEASE_RSA_N_HEX/s);
assert.ok(readme.includes("host connected but release verification not configured"));
assert.ok(readme.includes("CHECK")&&readme.includes("APPLY")&&readme.includes("fail"));
assert.equal(manifest.version_name,"1.19.1.26-AI-B");
console.log("round63-native-updater-trust-status: PASS");
