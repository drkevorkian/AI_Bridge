#!/usr/bin/env python3
"""AI Bridge Chrome Native Messaging updater host.

This host deliberately accepts only fixed operations. Repository/ref/URLs and
the extension root are installer-owned configuration and cannot be supplied by
extension messages or provider content.
"""
from __future__ import annotations

import json
import os
import re
import struct
import sys
from pathlib import Path
from typing import BinaryIO

from companion_updater import (
    PINNED_RELEASE_RSA_E,
    PINNED_RELEASE_RSA_N_HEX,
    UpdateError,
    apply_update,
    fetch_manifest,
)

HOST_NAME = "com.aibridge.updater"
SCHEMA = 1
MAX_INCOMING_BYTES = 64 * 1024
MAX_OUTGOING_BYTES = 1024 * 1024
EXTENSION_ID_RE = re.compile(r"^[a-p]{32}$")


class NativeHostError(RuntimeError):
    pass


def _binary_stdio() -> tuple[BinaryIO, BinaryIO]:
    if os.name == "nt":
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    return sys.stdin.buffer, sys.stdout.buffer


def _read_exact(stream: BinaryIO, size: int) -> bytes:
    chunks: list[bytes] = []
    remaining = size
    while remaining:
        chunk = stream.read(remaining)
        if not chunk:
            raise NativeHostError("Unexpected EOF in native message.")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def read_message(stream: BinaryIO) -> dict[str, object] | None:
    header = stream.read(4)
    if not header:
        return None
    if len(header) != 4:
        raise NativeHostError("Truncated native message header.")
    (length,) = struct.unpack("=I", header)
    if length <= 0 or length > MAX_INCOMING_BYTES:
        raise NativeHostError("Native message length is outside the allowed range.")
    payload = _read_exact(stream, length)
    try:
        value = json.loads(payload.decode("utf-8"))
    except Exception as exc:
        raise NativeHostError("Native message is not valid UTF-8 JSON.") from exc
    if not isinstance(value, dict):
        raise NativeHostError("Native message must be a JSON object.")
    return value


def write_message(stream: BinaryIO, value: dict[str, object]) -> None:
    payload = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if len(payload) > MAX_OUTGOING_BYTES:
        raise NativeHostError("Native response exceeds Chrome's 1 MiB host limit.")
    stream.write(struct.pack("=I", len(payload)))
    stream.write(payload)
    stream.flush()


def _load_config() -> dict[str, object]:
    path = Path(__file__).resolve().with_name("native-host-config.json")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise NativeHostError("Native host configuration is missing or invalid.") from exc
    if not isinstance(raw, dict) or raw.get("schema") != SCHEMA:
        raise NativeHostError("Unsupported native host configuration schema.")
    extension_id = str(raw.get("extension_id") or "").strip()
    if not EXTENSION_ID_RE.fullmatch(extension_id):
        raise NativeHostError("Configured extension ID is invalid.")
    root = Path(str(raw.get("extension_root") or "")).expanduser().resolve()
    if not (root / "manifest.json").is_file():
        raise NativeHostError("Configured extension root does not contain manifest.json.")
    return {"extension_id": extension_id, "extension_root": root}


def _verify_origin(extension_id: str, argv: list[str]) -> str:
    expected = f"chrome-extension://{extension_id}/"
    origin = str(argv[1] if len(argv) > 1 else "").strip()
    if origin != expected:
        raise NativeHostError("Caller origin does not match configured AI Bridge extension.")
    return origin


def _release_verification_status() -> dict[str, object]:
    """Return non-secret release-trust readiness for extension UI diagnostics."""
    modulus_hex = str(PINNED_RELEASE_RSA_N_HEX or "").strip().lower()
    configured = bool(modulus_hex)
    syntactically_valid = bool(
        configured
        and all(ch in "0123456789abcdef" for ch in modulus_hex)
        and int(PINNED_RELEASE_RSA_E) >= 3
        and int(PINNED_RELEASE_RSA_E) % 2 == 1
    )
    key_bits = 0
    if syntactically_valid:
        try:
            key_bits = int(modulus_hex, 16).bit_length()
        except ValueError:
            syntactically_valid = False
            key_bits = 0
    return {
        "configured": configured,
        "ready": syntactically_valid,
        "algorithm": "RSA-PKCS1-v1_5-SHA256",
        "key_bits": key_bits,
    }


def _command_name(message: dict[str, object]) -> str:
    command = str(message.get("command") or "").strip().upper()
    if command not in {"PING", "CHECK", "APPLY"}:
        raise NativeHostError("Unsupported native updater command.")
    allowed = {"command"} if command != "APPLY" else {"command", "checkpointId", "expectedVersion", "expectedBuild"}
    extra = set(message) - allowed
    if extra:
        raise NativeHostError("Native updater message contains unsupported fields.")
    return command


def handle_message(message: dict[str, object], config: dict[str, object]) -> dict[str, object]:
    command = _command_name(message)
    if command == "PING":
        return {
            "ok": True,
            "host": HOST_NAME,
            "schema": SCHEMA,
            "release_verification": _release_verification_status(),
        }
    if command == "CHECK":
        manifest = fetch_manifest()
        return {
            "ok": True,
            "available": {
                "version": manifest.version,
                "build": manifest.build,
                "files": len(manifest.files),
            },
        }

    checkpoint_id = str(message.get("checkpointId") or "").strip()
    expected_version = str(message.get("expectedVersion") or "").strip()
    expected_build = str(message.get("expectedBuild") or "").strip()
    if not checkpoint_id or len(checkpoint_id) > 128:
        raise NativeHostError("APPLY requires a bounded checkpointId.")
    if not expected_version or len(expected_version) > 128:
        raise NativeHostError("APPLY requires a bounded expectedVersion.")
    if not expected_build or len(expected_build) > 128:
        raise NativeHostError("APPLY requires a bounded expectedBuild.")
    result = apply_update(
        Path(config["extension_root"]),
        expected_version=expected_version,
        expected_build=expected_build,
    )
    return {
        "ok": True,
        "checkpointId": checkpoint_id,
        "version": str(result.get("version") or ""),
        "build": str(result.get("build") or ""),
        "files": list(result.get("files") or []),
        "reload_required": bool(result.get("reload_required")),
    }


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv if argv is None else argv)
    try:
        config = _load_config()
        _verify_origin(str(config["extension_id"]), args)
        reader, writer = _binary_stdio()
        message = read_message(reader)
        if message is None:
            raise NativeHostError("Chrome did not send a native message.")
        reply = handle_message(message, config)
    except (NativeHostError, UpdateError, OSError, ValueError) as exc:
        reply = {"ok": False, "error": str(exc)}
    except Exception as exc:  # fail closed; never expose traceback over protocol
        print(f"AI Bridge native host unexpected error: {exc}", file=sys.stderr)
        reply = {"ok": False, "error": "Native updater failed closed."}

    try:
        _, writer = _binary_stdio()
        write_message(writer, reply)
    except Exception as exc:
        print(f"AI Bridge native host response failure: {exc}", file=sys.stderr)
        return 1
    return 0 if reply.get("ok") is True else 1


if __name__ == "__main__":
    raise SystemExit(main())
