# AI A — v1.5 history/themes/layout handoff

Repository: https://github.com/drkevorkian/AI_Bridge
Review branch: https://github.com/drkevorkian/AI_Bridge/tree/ai-a/v1.5-history-themes

This pass is based on the tested v1.5 local-file candidate. The exact candidate source/ZIP is being handed to AI B for final source-file publication after review.

## Implemented locally by AI A

- Dashboard left/control column is exactly 40% of viewport width; transcript workspace is 60%.
- Persistent `bridgeHistory` storage, separate from relay transcript/session state.
- One combined Previous Jobs list for A/B/C, tagged by side/provider, newest first.
- Previous Commands list for prior human primary objectives.
- Reusing a job restores it to the same A/B/C role; reusing a command restores the primary-objective textarea.
- Consecutive/repeated identical history entries are deduplicated by moving the existing value to the top.
- History caps: 60 job entries, 40 command entries.
- Independent Clear controls for job history and command history.
- Three synchronized themes: Midnight, Slate, Light.
- Theme is stored as `aiBridgeTheme` in `chrome.storage.local` and shared between dashboard and popup.
- Manifest remains version `1.5.0` and description now includes 40% dashboard/history/themes/local-file ingestion.
- Content-script duplicate-load guard updated from stale `__AI_BRIDGE_LOADED_V13__` to `__AI_BRIDGE_LOADED_V15__`.
- Removed the duplicate `validateSavedBindings()` invocation found in the v1.5 candidate.
- README updated to AI Bridge 1.5 — Dashboard, Local Files, History & Themes.

## Backend contract

History is kept out of `bridgeState` so Stop/new-session transitions do not erase it. `AI_BRIDGE_GET_STATE` exposes a small cloned history payload; it does not affect transcript sequence/delta polling or source-file redaction.

New runtime message:

```js
{ type: "AI_BRIDGE_CLEAR_HISTORY", kind: "jobs" | "commands" | "all" }
```

History is recorded only after the initial AI prompt has been successfully delivered, avoiding failed-start junk entries.

## Verification already passed

- `node --check` for background.js, content.js, dashboard.js, popup.js.
- Manifest parses as JSON.
- Dashboard/popup have no duplicate HTML IDs.
- 40/60 layout static assertion passes.
- Midnight/Slate/Light theme selectors and CSS blocks exist.
- History normalization, recording, deduplication, snapshot exposure, source redaction, and transcript delta behavior pass a Node VM regression harness.
- ZIP integrity passes.

## AI B finalization request

Apply the exact candidate tree provided by AI A, re-run syntax/behavior checks, and publish **all actual v1.5 source files** to GitHub (not patch-only review artifacts):

`README.md`, `background.js`, `content.js`, `dashboard.css`, `dashboard.html`, `dashboard.js`, `manifest.json`, `popup.css`, `popup.html`, `popup.js`, plus unchanged `icon128.png`.

Do not bump beyond 1.5.0 for this feature pass.

## AI C review request

Review the 40% control-panel proportion, combined job-history density, command-history placement, and the three themes. No coding required; return UI/UX notes to AI A/B.
