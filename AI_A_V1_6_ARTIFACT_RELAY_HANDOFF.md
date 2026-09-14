# AI A handoff — v1.6 artifact relay + six themes

Base: current `main` / v1.5.0.

## Objective implemented in AI A candidate

1. Capture downloadable files produced inside a completed AI response.
2. Store binary payloads separately from normal bridge state.
3. Attach unseen generated files to the next AI before the text prompt is sent.
4. Reattach retained files on session Resume so replacement chats regain artifact context.
5. Resend repeats the same artifact set as the original outbound handoff.
6. Add Forest, Ocean, and Ember themes alongside Midnight, Slate, and Light.
7. Keep the 40/60 dashboard, local source ingestion, history, infinite-turn semantics, and strict human-input parsing.
8. Remove the duplicate `saveState()` call still present in v1.5 automatic-reconnect failure handling.

## Backend model

- New separate `bridgeArtifacts` key in `chrome.storage.local` holds base64 file payloads. `bridgeState` carries only bounded metadata and artifact IDs, so normal transcript/state polling does not rewrite ZIP contents on every turn.
- Transcript response entries may contain `artifactIds`.
- `normalTurnMessage()` selects artifact IDs from transcript entries that have not yet been delivered to the destination side.
- `recoveryMessage()` attaches all retained shared artifacts because Resume may point at a fresh AI conversation.
- `lastSentArtifactIdsBySide` makes Resend repeat the exact file set from the original outbound handoff.
- Limits in the candidate: 8 files/response, 12 MiB/file, 24 MiB/response; retained shelf 24 recent artifacts / 60 MiB with oldest-first eviction.
- Destination upload success is verified by `uploadedCount`; partial/missing attachment throws and pauses the bridge instead of silently continuing.

## Content-script capture/upload

- Response capture only examines download-like anchors in the latest assistant response container; ordinary links to GitHub/docs must not become attachments.
- HTTP(S), `blob:`, and `data:` links are fetched directly with credentials.
- ChatGPT `sandbox:/mnt/data/...` has a scoped fallback: when current conversation ID and the rendered `data-message-id` are available, construct the authenticated `/backend-api/conversation/{conversation}/interpreter/download?message_id=...&sandbox_path=...` route. The sandbox path must start with `/mnt/data/`.
- Before sending a handoff, the destination content script rebuilds `File` objects from base64, assigns them through `DataTransfer` to `input[type=file]`, dispatches `input`/`change`, waits for the UI, then sends the text prompt.
- If no uploader/file input can be exposed, fail the handoff rather than claim the file was shared.
- Content-script guard is bumped to `__AI_BRIDGE_LOADED_V16__`.

## Dashboard/UI candidate

- New `Shared AI files` shelf shows filename, source AI, size, and transcript sequence number. It contains metadata only, never binary/base64 bytes.
- Existing themes: Midnight, Slate, Light.
- Added themes: Forest, Ocean, Ember.
- Theme storage key remains `aiBridgeTheme`; popup and dashboard remain synchronized.

## Security/performance requirements for AI B

- Do not render artifact-provided names/content via `innerHTML`.
- Keep filename sanitization and byte/count limits.
- Keep artifact bytes out of `bridgeState`, transcript text, and dashboard polling.
- Preserve exact attachment-count verification.
- Keep bounded retention or infinite sessions can grow storage without limit.
- Do not broaden capture to all anchors.
- Keep ChatGPT sandbox fallback scoped to `/mnt/data/` and the current conversation/message.

## Known review target

Provider DOM churn is the main uncertainty. AI B should live-test ChatGPT -> Grok with a small generated ZIP and, if possible, Grok -> ChatGPT with a small generated file. If a provider uses a custom uploader that ignores `DataTransfer`, add an adapter-specific upload path instead of weakening the success check.

## AI A regression results

- `node --check`: background.js, content.js, dashboard.js, popup.js
- manifest JSON parse and candidate version 1.6.0
- duplicate HTML ID check
- six exact theme options in popup/dashboard
- 40%/60% layout retained
- artifact helper count/size/name-sanitization tests
- v1.5 duplicate reconnect `saveState()` call removed
- candidate ZIP integrity

Candidate ZIP SHA-256: `33c69bdea53eb3645c88a1b17a880bfd24a965102a1e393071608309609607b5`
