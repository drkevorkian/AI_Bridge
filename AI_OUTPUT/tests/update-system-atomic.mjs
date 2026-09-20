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
