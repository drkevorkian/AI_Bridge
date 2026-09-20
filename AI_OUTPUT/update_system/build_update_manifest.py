#!/usr/bin/env python3
"""Generate AI Bridge's selective runtime update manifest.

Run this from the repository root after the human has promoted a reviewed build
into root/main. Only the hard-coded runtime allowlist is hashed; AI_OUTPUT,
AI_INPUT, tests, CI files, and documentation can never enter the update manifest
implicitly.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ALLOWED_FILES = (
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
    "manifest.json",
    "update-checkpoint.js",
)

MAX_FILE_BYTES = 2 * 1024 * 1024


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_manifest(repo_root: Path) -> dict[str, object]:
    root = repo_root.resolve()
    manifest_path = root / "manifest.json"
    if not manifest_path.is_file():
        raise RuntimeError("Repository root does not contain manifest.json.")

    try:
        extension_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Could not read extension manifest: {exc}") from exc

    version = str(extension_manifest.get("version") or "").strip()
    build = str(
        extension_manifest.get("version_name")
        or extension_manifest.get("version")
        or ""
    ).strip()
    if not version or not build:
        raise RuntimeError("Extension manifest must define version/build identity.")

    files: list[dict[str, object]] = []
    for rel_path in ALLOWED_FILES:
        path = root / rel_path
        if path.is_symlink():
            raise RuntimeError(f"Refusing symlinked runtime file: {rel_path}")
        if not path.is_file():
            raise RuntimeError(f"Required runtime file is missing: {rel_path}")
        size = path.stat().st_size
        if size < 0 or size > MAX_FILE_BYTES:
            raise RuntimeError(f"Runtime file has unsafe size: {rel_path} ({size})")
        files.append(
            {
                "path": rel_path,
                "sha256": sha256_file(path),
                "size": size,
            }
        )

    return {
        "schema": 1,
        "version": version,
        "build": build,
        "source": {
            "repository": "drkevorkian/AI_Bridge",
            "ref": "main",
        },
        "files": files,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate the selective AI Bridge runtime update manifest."
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path.cwd(),
        help="Repository root containing the production extension files.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("update-manifest.json"),
        help="Output path. For production promotion this should be repository-root update-manifest.json.",
    )
    args = parser.parse_args()

    payload = build_manifest(args.repo_root)
    encoded = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    args.output.write_text(encoded, encoding="utf-8")
    print(
        json.dumps(
            {
                "ok": True,
                "version": payload["version"],
                "build": payload["build"],
                "files": len(payload["files"]),
                "output": str(args.output),
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
