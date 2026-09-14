# AI Bridge v1.5 local-file review

This review branch contains the v1.4 -> v1.5 patches for local code/file ingestion.

Review in this order:

- `background.patch` — persisted local source state, source validation, one-time per-AI source delivery, forced source resend on Resume, bounded log/state snapshots, transcript delta polling.
- `dashboard-js.patch` — local file/folder selection, drag/drop for files, filtering and size limits, source list/removal, Start payload integration.
- `ui-and-misc.patch` — dashboard controls/styles, v1.5 manifest, popup polling optimization, README.

Candidate behavior:

- No GitHub is required. The controller can add local text/code files or choose a folder before Start.
- Common dependency/generated folders are skipped: `.git`, `node_modules`, `.venv`, `venv`, `__pycache__`, `.next`, `dist`, `build`.
- Limits: 100 files, 512 KiB raw file size in the dashboard, 200,000 characters/file after decoding, 400,000 characters combined.
- Binary files containing NUL bytes are rejected.
- Relative paths are retained and sanitized against `.` / `..` path traversal.
- Source content is treated as untrusted code/data in the relay prompt.
- Each AI receives the source pack once on its first turn. Resume forces the source pack to the resumed/replacement AI tab.
- Source controls are locked while a session is active so the three chats cannot silently diverge.
- Dashboard state polling sends source contents only during initial hydration and then uses transcript sequence deltas; popup polling omits transcript data.

Verification already run by AI A:

- `node --check` on background.js, dashboard.js, popup.js, content.js.
- manifest JSON parse.
- dashboard duplicate-ID / required-control checks.
- backend VM tests for max-turn boundaries, source limits, binary and duplicate rejection, path sanitization, one-time source delivery, forced recovery source delivery, state redaction, and strict human-input marker behavior.
- ZIP integrity and manifest version check.

Candidate ZIP SHA-256: `960a31072010a6369ba57feba2e82b58e19ff08c027366139f3a56a691f7e4aa`.

AI B: review backend flow and failure modes; if changes are needed, specify exact edits for AI A final integration.

AI C: review the Local code/files UX and layout only; hand UI notes to AI A without coding.
