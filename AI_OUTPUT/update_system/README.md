# AI Bridge selective live update system — review slice

This directory is **AI_OUTPUT review-only**. Nothing here is wired into the
production/root extension or AI_INPUT yet.

## Objective

Update the unpacked AI Bridge extension from the repository's **main** branch
without downloading the development workspace and without losing an active AI
Bridge workflow.

The repository root is intentionally shared by:

- the production extension runtime;
- AI_OUTPUT development/review work;
- AI_INPUT human-test builds;
- tests and CI.

Therefore the updater MUST NOT treat "everything on main" as extension payload.

## MV3 boundary

Manifest V3 does not permit the extension to fetch and execute arbitrary remote
JavaScript. Packaged extension files also cannot be safely rewritten by the
running service worker itself.

The update design therefore has two cooperating pieces:

1. **Extension control plane**
   - fetches only `update-manifest.json` from pinned
     `drkevorkian/AI_Bridge/main`;
   - validates version/build and the exact runtime allowlist;
   - checkpoints the current Bridge session and pending delivery state;
   - asks a registered native-messaging updater companion to apply the update;
   - calls `chrome.runtime.reload()` only after a fully verified update reply;
   - resumes from the durable checkpoint after startup.

2. **Local updater companion**
   - runs outside the Chrome extension package;
   - downloads only files named in the signed/hashed selective manifest;
   - pins downloads to
     `https://raw.githubusercontent.com/drkevorkian/AI_Bridge/main/`;
   - verifies SHA-256 and optional size for every file;
   - stages the entire update before replacing any live file;
   - rejects traversal, symlinks, non-runtime files, duplicate entries, and
     unsupported manifest schemas;
   - backs up live files and atomically replaces them;
   - replaces `manifest.json` last;
   - rolls back already-replaced files if any replacement fails.

## Runtime allowlist

Only these root extension files are eligible:

- manifest.json
- update-checkpoint.js
- background.js
- content.js
- dashboard.html
- dashboard.js
- dashboard.css
- dashboard-layouts.js
- dashboard-layouts.css
- popup.html
- popup.js
- popup.css
- settings.html
- settings.js
- settings.css
- icon128.png

Not eligible, even though they live on main:

- AI_OUTPUT/**
- AI_INPUT/**
- tests/**
- .github/**
- README.md
- branches/tags/other refs
- arbitrary newly-created files

A new runtime file requires an explicit human-reviewed allowlist change before
the updater can ever install it.

## Publisher workflow

After a human accepts a build and promotes it to root/main:

```text
python AI_OUTPUT/update_system/build_update_manifest.py \
  --repo-root . \
  --output update-manifest.json
```

The generator:

- reads root `manifest.json` for numeric version and visible build;
- hashes only the fixed runtime allowlist;
- records SHA-256 + byte size;
- pins source repository/ref to `drkevorkian/AI_Bridge/main`.

The generated root `update-manifest.json` is the only package map the updater
will accept.

## Native messaging plan

Host name:

`com.aibridge.updater`

The host manifest will use `allowed_origins` with the exact AI Bridge extension
ID. No wildcard origin is permitted.

The extension will require the `nativeMessaging` permission only when this
slice is promoted.

Platform installers must register the host in the official Chrome user-level
native messaging location:

- Windows: HKCU native-messaging-host registry entry.
- macOS: user Chrome `NativeMessagingHosts` directory.
- Linux: user Chrome `NativeMessagingHosts` directory.

The host protocol must use Chrome's length-prefixed native messaging framing.
Diagnostic text goes to stderr only; stdout is protocol-only.

## Zero-work-loss update sequence

Target sequence:

```text
UPDATE_AVAILABLE
  -> validate selective manifest
  -> pause new dispatch creation
  -> allow already-running provider response to reach a safe commit boundary
  -> persist UPDATE_CHECKPOINT
  -> native companion stages + hashes all files
  -> native companion atomically replaces runtime files
  -> native companion returns UPDATE_APPLIED
  -> service worker calls chrome.runtime.reload()
  -> startup guard restores UPDATE_CHECKPOINT
  -> re-register document authorities
  -> reconcile dispatch ledger / parked responses
  -> resume bridge at the exact pre-update safe boundary
```

No reload is allowed while a response is only partially observed or a delivery
outcome is ambiguous.

## Security invariants

1. Never execute remote JS/CSS/HTML directly from GitHub.
2. Never accept a manifest URL supplied by a content script or web page.
3. Never accept arbitrary update paths from the extension UI.
4. Never update from a branch other than `main`.
5. Never replace a symlink.
6. Never follow path traversal.
7. Verify every SHA-256 before the first live replacement.
8. Replace `manifest.json` last.
9. Roll back the whole batch after any replacement failure.
10. Persist the runtime checkpoint before requesting file mutation.
11. Resume only after startup authority/ledger reconciliation succeeds.
12. If the native host is unavailable, fail closed and leave the current build
    running unchanged.

## Current files

- `companion_updater.py` — secure selective atomic update engine.
- `build_update_manifest.py` — publisher-side selective manifest generator.
- `../tests/update-system-atomic.mjs` — traversal, allowlist, hash, rollback,
  symlink, and success regressions.

## Not implemented yet

- native-messaging framing/host installer;
- extension-side `nativeMessaging` permission;
- durable update checkpoint stages and guarded `chrome.runtime.reload()`;
- startup reinjection/rebind/reconciliation before relay resume;
- production root `update-manifest.json`;
- AI_INPUT promotion.

Those remain gated on review and green CI.


## Crash-recoverable update checkpoint

The review runtime now uses these durable stages:

`DRAINING → CHECKPOINTED → APPLIED_NOT_RELOADED → RELOADED_NOT_REBOUND → READY_TO_RESUME → COMPLETE`

During DRAINING no new provider action may start, but an already-running response may finish. Its response commit and `nextTurnPending` record must become durable before CHECKPOINTED.

After reload, every bound provider tab is reinjected through the packaged version-aware `content.js` lifecycle without refreshing the provider page. The new document registration must prove the same tab, provider, documentId, generation epoch, and conversation identity captured before mutation. Only then may the checkpoint reach READY_TO_RESUME.

If the service worker dies at any checkpoint phase, the next worker resumes from that same durable phase. A build mismatch, authority mismatch, ambiguous delivery, parked response, provider recovery, or rollover activity fails closed into UPDATE_RECOVERY_FAILED.
