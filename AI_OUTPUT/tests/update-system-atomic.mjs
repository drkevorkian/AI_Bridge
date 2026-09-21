import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const updater = path.join(repo, "AI_OUTPUT/update_system/companion_updater.py");

const py = String.raw`
import hashlib, importlib.util, json, os, pathlib, sys, tempfile
from unittest import mock

UPDATER = pathlib.Path(os.environ["UPDATER"])
spec = importlib.util.spec_from_file_location("aibridge_updater", UPDATER)
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

def digest(data):
    return hashlib.sha256(data).hexdigest()


# Detached release signature security.
SIGNED_MANIFEST = b'{"schema":1,"version":"9.9.9","build":"test","files":[]}'
TEST_RSA_N = (
    "bceb77fae88a03e40f526cf36a69b2cc76e13ec7d19c27439266e11ecfc704d7"
    "16be9011f0a3fb7e7e26d6d4f75a8f0042ad21404086eef6778b4601555c57d3"
    "20511e86af258ceb0999ef3a7c8595c4a52db71eb9f160921bcb25ca558bc0332"
    "9f5732e42e796da90e5aa30c3261a860caacf854da4a25515d9d42244f206663"
    "954b0830438f751ab81a69c5018c1eb06f29bd14becdaceef1edc0f2d06ae5d9"
    "ee52e607e495b7e28c1f7e31e5ef394f2e4d39aae7297e14deb3305869cc15f5"
    "30ffcbbfc845be10dae23e5bbca6d6f823857dcbac788b47cd93e5e3c70a7bf6"
    "4ce7e3d2210c5d7d96caa57a81aa0b58cabccf75a1c5d6ad00f70bf1958cd15"
)
TEST_SIGNATURE = (
    b"YFj4Tau1izvs7jljp2/gklGMBZYdfJnMC0qwm7IAaPu6kFhB7i17N2aZxxuyhtce"
    b"gzxqcxQfzL0Hi2pefPLhd5XXK6/Pq0jXTyGWcEQ4BNLLazM1Qe+7BqnRK9Vkw4cx"
    b"3Xyylr/0aYbbs46lswFVWbhhwjwZv28HzXxkZaHvVJv+OmsqvfzEH9SMcbCLkGdG"
    b"2jeo2J45wAuJ9vZ5uvRK4uVT6rjnmifpMj/hMDCj8Ai4wYNm09xGfV3gUEpIsZZL"
    b"SPsLlYTf+rg67m/B8W/P2heN5J8lqDI/HaLk1cWSjoM8uH/zp2QPQ8t6e5zZsBQr"
    b"Wexf19SFrV/6ou2h4NMYjQ=="
)

mod.verify_detached_signature(
    SIGNED_MANIFEST,
    TEST_SIGNATURE,
    modulus_hex=TEST_RSA_N,
    exponent=65537,
)

try:
    mod.verify_detached_signature(
        SIGNED_MANIFEST + b" ",
        TEST_SIGNATURE,
        modulus_hex=TEST_RSA_N,
        exponent=65537,
    )
    raise AssertionError("tampered manifest signature was accepted")
except mod.UpdateError:
    pass

try:
    mod.verify_detached_signature(
        SIGNED_MANIFEST,
        b"not-base64***",
        modulus_hex=TEST_RSA_N,
        exponent=65537,
    )
    raise AssertionError("malformed detached signature was accepted")
except mod.UpdateError:
    pass

try:
    mod.verify_detached_signature(
        SIGNED_MANIFEST,
        TEST_SIGNATURE,
        modulus_hex="",
        exponent=65537,
    )
    raise AssertionError("automatic update accepted without pinned release key")
except mod.UpdateError as exc:
    assert "public key is not configured" in str(exc)

try:
    mod.verify_detached_signature(
        SIGNED_MANIFEST,
        TEST_SIGNATURE,
        modulus_hex="f" * 256,
        exponent=65537,
    )
    raise AssertionError("weak 1024-bit release key was accepted")
except mod.UpdateError as exc:
    assert "at least 2048 bits" in str(exc)

# Manifest security.
try:
    mod.parse_manifest(json.dumps({
        "schema":1,"version":"1.2.3","build":"x",
        "files":[{"path":"AI_OUTPUT/evil.js","sha256":"0"*64}]
    }))
    raise AssertionError("development path was accepted")
except mod.UpdateError:
    pass

try:
    mod.parse_manifest(json.dumps({
        "schema":1,"version":"1.2.3","build":"x",
        "files":[{"path":"../background.js","sha256":"0"*64}]
    }))
    raise AssertionError("path traversal was accepted")
except mod.UpdateError:
    pass

with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp)
    (root/"manifest.json").write_text('{"old":true}', encoding="utf-8")
    (root/"background.js").write_text("old-bg", encoding="utf-8")

    files = {
        "background.js": b"new-bg",
        "manifest.json": b'{"new":true}',
    }
    manifest = mod.parse_manifest(json.dumps({
        "schema":1,"version":"1.2.3","build":"1.2.3.01-AI-A",
        "files":[
            {"path":"manifest.json","sha256":digest(files["manifest.json"]),"size":len(files["manifest.json"])},
            {"path":"background.js","sha256":digest(files["background.js"]),"size":len(files["background.js"])},
        ]
    }))
    assert manifest.files[-1].path == "manifest.json"

    def fake_fetch(url, max_bytes):
        name = url.rsplit("/",1)[-1]
        return files[name]

    with mock.patch.object(mod, "_fetch_bytes", side_effect=fake_fetch):
        result = mod.AtomicUpdater(root).apply(manifest)
    assert result["ok"] is True
    assert (root/"background.js").read_bytes() == files["background.js"]
    assert (root/"manifest.json").read_bytes() == files["manifest.json"]

with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp)
    (root/"manifest.json").write_text("old-manifest", encoding="utf-8")
    (root/"background.js").write_text("old-bg", encoding="utf-8")
    bad = b"tampered"
    manifest = mod.parse_manifest(json.dumps({
        "schema":1,"version":"1.2.4","build":"bad",
        "files":[{"path":"background.js","sha256":digest(b"expected")}]
    }))
    with mock.patch.object(mod, "_fetch_bytes", return_value=bad):
        try:
            mod.AtomicUpdater(root).apply(manifest)
            raise AssertionError("hash mismatch update succeeded")
        except mod.UpdateError:
            pass
    assert (root/"background.js").read_text(encoding="utf-8") == "old-bg"
    assert (root/"manifest.json").read_text(encoding="utf-8") == "old-manifest"

with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp)
    (root/"manifest.json").write_text("old-manifest", encoding="utf-8")
    (root/"background.js").write_text("old-bg", encoding="utf-8")
    files = {"background.js":b"new-bg","manifest.json":b"new-manifest"}
    manifest = mod.parse_manifest(json.dumps({
        "schema":1,"version":"1.2.5","build":"rollback",
        "files":[
            {"path":"background.js","sha256":digest(files["background.js"])},
            {"path":"manifest.json","sha256":digest(files["manifest.json"])},
        ]
    }))
    def fake_fetch(url, max_bytes):
        return files[url.rsplit("/",1)[-1]]
    real_replace = os.replace
    calls = {"n":0}
    def flaky_replace(src, dst):
        calls["n"] += 1
        if calls["n"] == 2:
            raise OSError("simulated replace failure")
        return real_replace(src, dst)
    with mock.patch.object(mod, "_fetch_bytes", side_effect=fake_fetch), mock.patch.object(mod.os, "replace", side_effect=flaky_replace):
        try:
            mod.AtomicUpdater(root).apply(manifest)
            raise AssertionError("replacement failure did not abort")
        except mod.UpdateError:
            pass
    assert (root/"background.js").read_text(encoding="utf-8") == "old-bg"
    assert (root/"manifest.json").read_text(encoding="utf-8") == "old-manifest"

with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp)
    (root/"manifest.json").write_text("old", encoding="utf-8")
    target = root/"background.js"
    outside = root.parent/"aibridge-outside-test.js"
    outside.write_text("outside", encoding="utf-8")
    try:
        target.symlink_to(outside)
        manifest = mod.parse_manifest(json.dumps({
            "schema":1,"version":"1","build":"symlink",
            "files":[{"path":"background.js","sha256":digest(b"x")}]
        }))
        with mock.patch.object(mod, "_fetch_bytes", return_value=b"x"):
            try:
                mod.AtomicUpdater(root).apply(manifest)
                raise AssertionError("symlink target was accepted")
            except mod.UpdateError:
                pass
        assert outside.read_text(encoding="utf-8") == "outside"
    finally:
        try: outside.unlink()
        except FileNotFoundError: pass

print("update-system-atomic: PASS")
`;

const run = spawnSync(process.env.PYTHON || "python3", ["-c", py], {
  cwd: repo,
  env: { ...process.env, UPDATER: updater },
  encoding: "utf8",
});
if (run.status !== 0) {
  console.error(run.stdout);
  console.error(run.stderr);
  process.exit(run.status ?? 1);
}
assert.match(run.stdout, /update-system-atomic: PASS/);
console.log(run.stdout.trim());
