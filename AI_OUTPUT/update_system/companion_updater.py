#!/usr/bin/env python3
"""AI Bridge selective updater companion.

Review-only implementation. This process runs outside Chrome's extension package
so it can replace files on disk without violating Manifest V3's remote-code
rules. The extension-side integration will later checkpoint state, invoke this
companion, then call chrome.runtime.reload() only after a fully verified atomic
batch succeeds.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import tempfile
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

MANIFEST_URL = (
    "https://raw.githubusercontent.com/drkevorkian/AI_Bridge/main/"
    "update-manifest.json"
)
RAW_PREFIX = "https://raw.githubusercontent.com/drkevorkian/AI_Bridge/main/"

# Only runtime extension files may ever be replaced from main. Development
# workspaces and tests are intentionally excluded.
ALLOWED_FILES = frozenset(
    {
        "manifest.json",
        "update-checkpoint.js",
        "background.js",
        "content.js",
        "dashboard.html",
        "dashboard.js",
        "dashboard.css",
        "dashboard-layouts.js",
        "dashboard-layouts.css",
        "popup.html",
        "popup.js",
        "popup.css",
        "settings.html",
        "settings.js",
        "settings.css",
        "icon128.png",
    }
)

MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_MANIFEST_BYTES = 256 * 1024


class UpdateError(RuntimeError):
    """Raised when an update cannot be proven safe."""


@dataclass(frozen=True)
class FileSpec:
    path: str
    sha256: str
    size: int | None = None


@dataclass(frozen=True)
class UpdateManifest:
    schema: int
    version: str
    build: str
    files: tuple[FileSpec, ...]


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _validate_rel_path(raw: object) -> str:
    path = str(raw or "").strip().replace("\\", "/")
    if not path or path.startswith("/") or path.startswith("../"):
        raise UpdateError("Update path must be a safe repository-relative file.")
    parts = path.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise UpdateError(f"Unsafe update path: {path!r}")
    if path not in ALLOWED_FILES:
        raise UpdateError(f"File is not in the runtime update allowlist: {path}")
    return path


def parse_manifest(payload: bytes | str) -> UpdateManifest:
    if isinstance(payload, bytes):
        if len(payload) > MAX_MANIFEST_BYTES:
            raise UpdateError("Update manifest is too large.")
        text = payload.decode("utf-8")
    else:
        text = str(payload)
        if len(text.encode("utf-8")) > MAX_MANIFEST_BYTES:
            raise UpdateError("Update manifest is too large.")

    try:
        raw = json.loads(text)
    except json.JSONDecodeError as exc:
        raise UpdateError(f"Invalid update manifest JSON: {exc}") from exc

    if not isinstance(raw, dict) or raw.get("schema") != 1:
        raise UpdateError("Unsupported update manifest schema.")

    version = str(raw.get("version") or "").strip()
    build = str(raw.get("build") or "").strip()
    if not version or not build:
        raise UpdateError("Manifest version and build are required.")

    rows = raw.get("files")
    if not isinstance(rows, list) or not rows:
        raise UpdateError("Manifest files must be a non-empty list.")

    seen: set[str] = set()
    specs: list[FileSpec] = []
    for row in rows:
        if not isinstance(row, dict):
            raise UpdateError("Each manifest file entry must be an object.")
        path = _validate_rel_path(row.get("path"))
        if path in seen:
            raise UpdateError(f"Duplicate update path: {path}")
        seen.add(path)

        digest = str(row.get("sha256") or "").strip().lower()
        if len(digest) != 64 or any(ch not in "0123456789abcdef" for ch in digest):
            raise UpdateError(f"Invalid SHA-256 for {path}")

        size_raw = row.get("size")
        size: int | None = None
        if size_raw is not None:
            try:
                size = int(size_raw)
            except (TypeError, ValueError) as exc:
                raise UpdateError(f"Invalid size for {path}") from exc
            if size < 0 or size > MAX_FILE_BYTES:
                raise UpdateError(f"Unsafe size for {path}: {size}")

        specs.append(FileSpec(path=path, sha256=digest, size=size))

    # manifest.json is replaced last so the package identity cannot advance
    # before all executable/UI assets are already in place.
    specs.sort(key=lambda spec: spec.path == "manifest.json")
    return UpdateManifest(
        schema=1, version=version, build=build, files=tuple(specs)
    )


def _safe_target(root: Path, rel_path: str) -> Path:
    root = root.resolve()
    target = root / rel_path
    if target.exists() and target.is_symlink():
        raise UpdateError(f"Refusing to replace symlink: {rel_path}")
    resolved_parent = target.parent.resolve()
    if resolved_parent != root:
        raise UpdateError(f"Update target escaped extension root: {rel_path}")
    return target


def _fetch_bytes(url: str, max_bytes: int) -> bytes:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https":
        raise UpdateError("Updates require HTTPS.")
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "AI-Bridge-Updater/1"},
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        if response.status != 200:
            raise UpdateError(f"HTTP {response.status} fetching {url}")
        data = response.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise UpdateError(f"Remote file exceeds size limit: {url}")
    return data


def fetch_manifest(url: str = MANIFEST_URL) -> UpdateManifest:
    if url != MANIFEST_URL:
        raise UpdateError("Only the pinned AI Bridge main update manifest is allowed.")
    return parse_manifest(_fetch_bytes(url, MAX_MANIFEST_BYTES))


def _file_url(rel_path: str) -> str:
    safe = _validate_rel_path(rel_path)
    encoded = "/".join(urllib.parse.quote(part, safe="") for part in safe.split("/"))
    url = RAW_PREFIX + encoded
    if not url.startswith(RAW_PREFIX):
        raise UpdateError("Generated update URL escaped the pinned repository.")
    return url


class AtomicUpdater:
    """Stages, verifies, replaces, and rolls back one update transaction."""

    def __init__(self, extension_root: Path):
        self.root = extension_root.resolve()
        if not (self.root / "manifest.json").is_file():
            raise UpdateError("Extension root must contain manifest.json.")

    def _download(self, spec: FileSpec) -> bytes:
        data = _fetch_bytes(_file_url(spec.path), MAX_FILE_BYTES)
        if spec.size is not None and len(data) != spec.size:
            raise UpdateError(
                f"Size mismatch for {spec.path}: expected {spec.size}, got {len(data)}"
            )
        actual = _sha256(data)
        if actual != spec.sha256:
            raise UpdateError(
                f"SHA-256 mismatch for {spec.path}: expected {spec.sha256}, got {actual}"
            )
        return data

    def apply(self, manifest: UpdateManifest) -> dict[str, object]:
        staged_dir = Path(
            tempfile.mkdtemp(prefix=".aibridge-stage-", dir=str(self.root))
        )
        backup_dir = Path(
            tempfile.mkdtemp(prefix=".aibridge-backup-", dir=str(self.root))
        )
        replaced: list[str] = []
        had_original: dict[str, bool] = {}

        try:
            # Phase 1: fetch and verify every file before touching live files.
            for spec in manifest.files:
                target = _safe_target(self.root, spec.path)
                data = self._download(spec)
                staged = staged_dir / spec.path
                staged.parent.mkdir(parents=True, exist_ok=True)
                staged.write_bytes(data)
                if _sha256(staged.read_bytes()) != spec.sha256:
                    raise UpdateError(f"Staged verification failed for {spec.path}")
                _ = target

            # Phase 2: snapshot originals then atomically replace each target.
            for spec in manifest.files:
                target = _safe_target(self.root, spec.path)
                staged = staged_dir / spec.path
                backup = backup_dir / spec.path
                had_original[spec.path] = target.exists()
                if target.exists():
                    if not target.is_file():
                        raise UpdateError(f"Target is not a regular file: {spec.path}")
                    backup.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(target, backup)

                os.replace(staged, target)
                replaced.append(spec.path)

            return {
                "ok": True,
                "version": manifest.version,
                "build": manifest.build,
                "files": replaced,
                "reload_required": True,
            }
        except Exception as exc:
            # Roll back only paths already replaced, in reverse order.
            rollback_errors: list[str] = []
            for rel_path in reversed(replaced):
                target = self.root / rel_path
                backup = backup_dir / rel_path
                try:
                    if had_original.get(rel_path):
                        os.replace(backup, target)
                    elif target.exists():
                        target.unlink()
                except Exception as rollback_exc:  # pragma: no cover - catastrophic
                    rollback_errors.append(f"{rel_path}: {rollback_exc}")

            detail = str(exc)
            if rollback_errors:
                detail += " | rollback errors: " + "; ".join(rollback_errors)
            raise UpdateError(detail) from exc
        finally:
            shutil.rmtree(staged_dir, ignore_errors=True)
            shutil.rmtree(backup_dir, ignore_errors=True)


def apply_update(extension_root: Path, manifest_url: str = MANIFEST_URL) -> dict[str, object]:
    manifest = fetch_manifest(manifest_url)
    return AtomicUpdater(extension_root).apply(manifest)


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="AI Bridge selective atomic updater")
    parser.add_argument(
        "--extension-root",
        required=True,
        type=Path,
        help="Path to the unpacked AI Bridge extension directory.",
    )
    parser.add_argument(
        "--manifest-url",
        default=MANIFEST_URL,
        help="Pinned main-branch runtime update manifest.",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    try:
        result = apply_update(args.extension_root, args.manifest_url)
    except UpdateError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, sort_keys=True))
        return 1

    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
