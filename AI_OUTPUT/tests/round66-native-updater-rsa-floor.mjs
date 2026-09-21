import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
const updateDir=path.resolve(here,"../update_system");

const py=String.raw`
import importlib, os, pathlib, sys
update_dir=pathlib.Path(os.environ["UPDATE_DIR"])
sys.path.insert(0,str(update_dir))
import companion_updater as companion
import native_host as host

assert companion.MIN_RELEASE_RSA_BITS == 2048

weak="f"*256
try:
    companion.validate_release_public_key(weak,65537)
    raise AssertionError("weak 1024-bit key accepted")
except companion.UpdateError as exc:
    assert "at least 2048 bits" in str(exc)

host.PINNED_RELEASE_RSA_N_HEX=weak
host.PINNED_RELEASE_RSA_E=65537
status=host._release_verification_status()
assert status["configured"] is True
assert status["ready"] is False
assert status["key_bits"] == 1024
assert status["minimum_key_bits"] == 2048

strong=("bceb77fae88a03e40f526cf36a69b2cc76e13ec7d19c27439266e11ecfc704d7"
"16be9011f0a3fb7e7e26d6d4f75a8f0042ad21404086eef6778b4601555c57d3"
"20511e86af258ceb0999ef3a7c8595c4a52db71eb9f160921bcb25ca558bc0332"
"9f5732e42e796da90e5aa30c3261a860caacf854da4a25515d9d42244f206663"
"954b0830438f751ab81a69c5018c1eb06f29bd14becdaceef1edc0f2d06ae5d9"
"ee52e607e495b7e28c1f7e31e5ef394f2e4d39aae7297e14deb3305869cc15f5"
"30ffcbbfc845be10dae23e5bbca6d6f823857dcbac788b47cd93e5e3c70a7bf6"
"4ce7e3d2210c5d7d96caa57a81aa0b58cabccf75a1c5d6ad00f70bf1958cd15")
host.PINNED_RELEASE_RSA_N_HEX=strong
status=host._release_verification_status()
assert status["configured"] is True
assert status["ready"] is True
assert status["key_bits"] >= 2048
assert status["minimum_key_bits"] == 2048

print("round66-native-updater-rsa-floor: PASS")
`;

let pyExe=process.env.PYTHON||"python3";
let run=spawnSync(pyExe,["-c",py],{env:{...process.env,UPDATE_DIR:updateDir},encoding:"utf8"});
if(run.error?.code==="ENOENT"&&pyExe==="python3"){
  pyExe="python";
  run=spawnSync(pyExe,["-c",py],{env:{...process.env,UPDATE_DIR:updateDir},encoding:"utf8"});
}
if(run.status!==0){
  console.error(run.stdout);
  console.error(run.stderr);
  process.exit(run.status??1);
}
assert.match(run.stdout,/round66-native-updater-rsa-floor: PASS/);
console.log(run.stdout.trim());
