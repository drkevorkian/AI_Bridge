#!/usr/bin/env python3
"""Install AI Bridge's review native messaging host for the current user."""
from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import stat
import sys
from pathlib import Path

HOST_NAME = "com.aibridge.updater"
EXTENSION_ID_RE = re.compile(r"^[a-p]{32}$")


def _default_install_dir() -> Path:
    system = platform.system()
    if system == "Windows":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData/Local")
        return base / "AI Bridge" / "Updater"
    return Path.home() / ".local" / "share" / "ai-bridge-updater"


def _manifest_dir(browser: str) -> Path:
    system = platform.system()
    home = Path.home()
    if system == "Darwin":
        mapping = {
            "chrome": home / "Library/Application Support/Google/Chrome/NativeMessagingHosts",
            "chrome-for-testing": home / "Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts",
            "chromium": home / "Library/Application Support/Chromium/NativeMessagingHosts",
        }
    else:
        mapping = {
            "chrome": home / ".config/google-chrome/NativeMessagingHosts",
            "chrome-for-testing": home / ".config/google-chrome-for-testing/NativeMessagingHosts",
            "chromium": home / ".config/chromium/NativeMessagingHosts",
        }
    return mapping[browser]


def _write_launcher(install_dir: Path, python: Path) -> Path:
    system = platform.system()
    host_py = install_dir / "native_host.py"
    if system == "Windows":
        launcher = install_dir / "native_host.bat"
        launcher.write_text(f'@echo off\r\n"{python}" "{host_py}" %*\r\n', encoding="utf-8")
        return launcher
    launcher = install_dir / "native_host"
    launcher.write_text(f'#!/bin/sh\nexec "{python}" "{host_py}" "$@"\n', encoding="utf-8")
    launcher.chmod(launcher.stat().st_mode | stat.S_IXUSR)
    return launcher


def main() -> int:
    parser = argparse.ArgumentParser(description="Install AI Bridge native updater host")
    parser.add_argument("--extension-id", required=True)
    parser.add_argument("--extension-root", required=True, type=Path)
    parser.add_argument("--browser", choices=("chrome","chrome-for-testing","chromium"), default="chrome")
    parser.add_argument("--install-dir", type=Path, default=_default_install_dir())
    args = parser.parse_args()

    extension_id = args.extension_id.strip()
    if not EXTENSION_ID_RE.fullmatch(extension_id):
        raise SystemExit("Invalid Chrome extension ID.")
    extension_root = args.extension_root.expanduser().resolve()
    if not (extension_root / "manifest.json").is_file():
        raise SystemExit("Extension root must contain manifest.json.")

    source_dir = Path(__file__).resolve().parent
    install_dir = args.install_dir.expanduser().resolve()
    install_dir.mkdir(parents=True, exist_ok=True)
    for name in ("native_host.py","companion_updater.py"):
        shutil.copy2(source_dir / name, install_dir / name)

    config = {
        "schema": 1,
        "extension_id": extension_id,
        "extension_root": str(extension_root),
    }
    (install_dir / "native-host-config.json").write_text(
        json.dumps(config, indent=2) + "\n", encoding="utf-8"
    )
    launcher = _write_launcher(install_dir, Path(sys.executable).resolve())
    host_manifest = {
        "name": HOST_NAME,
        "description": "AI Bridge selective live updater",
        "path": str(launcher.resolve()),
        "type": "stdio",
        "allowed_origins": [f"chrome-extension://{extension_id}/"],
    }

    manifest_path = install_dir / f"{HOST_NAME}.json"
    manifest_path.write_text(json.dumps(host_manifest, indent=2) + "\n", encoding="utf-8")

    if platform.system() == "Windows":
        import winreg
        key_path = rf"Software\Google\Chrome\NativeMessagingHosts\{HOST_NAME}"
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, key_path) as key:
            winreg.SetValueEx(key, "", 0, winreg.REG_SZ, str(manifest_path))
        registered = str(manifest_path)
    else:
        target_dir = _manifest_dir(args.browser)
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / f"{HOST_NAME}.json"
        shutil.copy2(manifest_path, target)
        registered = str(target)

    print(json.dumps({
        "ok": True,
        "host": HOST_NAME,
        "extension_id": extension_id,
        "extension_root": str(extension_root),
        "registered_manifest": registered,
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
