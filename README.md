# AI Bridge 1.18.0 — Rebuilt Settings + Dynamic Teams

Version 1.18.0 keeps the working v1.16 relay/state engine and rebuilds the missing user-facing additions as isolated services rather than restoring the broken v1.17 runtime stack.

## 1.18.0 release notes

- **All eight themes preserved:** Blizzard Blue, Ghost White, Midnight, Slate, Light, Solarized Light, Ocean, and Terminal.
- **Dedicated Settings workspace:** appearance, layouts, portable settings, Google Drive app-data sync, provider health, runtime power, and update controls live outside the relay startup path.
- **Three dashboard layouts:** Studio, Classic, and Focus are applied by a small layout-only module that never rewrites relay state.
- **Portable settings:** Chrome Sync Push/Pull stores appearance and reusable team preferences but excludes transcripts, Vault files, access tokens, tab IDs, and active-session state.
- **Google Drive appDataFolder:** optional OAuth-PKCE flow with a user-supplied client ID; access tokens are kept in session storage and are never synced.
- **Provider Health:** checks open supported AI tabs and verifies their content scripts respond without blocking Start or mutating relay state.
- **Keep-awake control:** uses Chrome's power API and can be released immediately from Settings.
- **Update controls:** manual GitHub version check, ZIP download, and optional daily notification-only checks.
- **Stable dynamic team core:** 1–5 logical agents, including multiple separate tabs from the same LLM provider, remain on the v1.16 state-v3 relay implementation.
- **No Slice 77 runtime restore:** the old wrapper, state-v4, provider-health gate, viewpoint runtime, cloud-settings-v2, and watchdog stacks are not used.

## 1.16 historical release notes

- **1–5 active agents:** choose how many logical AI slots participate before starting a session. The active relay roster expands from A through E.
- **Same-LLM multi-tab teams:** ChatGPT, Grok, Gemini, Claude, or Copilot may occupy multiple logical slots as long as every slot uses a different browser tab. This lets one LLM converse with another instance of itself or have more representation in a team.
- **Independent roles and context:** every active tab keeps its own assigned job, provider conversation, timers, resend state, transcript attribution, artifact routing, and human-input routing.
- **Dynamic work modes:** Relay, Collaborate, Compete, Parallel, Peer Review, and Direct Mesh all use the active roster. Batch-mode minimum turn counts scale with team size.
- **Fresh-chat support:** New AI chats and Start in fresh AI chats operate across the selected active roster, including D and E.
- **Scope boundary preserved:** this release does not restore the later OAuth, Provider Health, state-v4, cloud-sync, watchdog, or experimental viewpoint-overlay architecture.
- **State compatibility:** the persisted state schema remains version 3; existing three-agent sessions load as a three-agent roster.

## 1.15 historical release notes

- **Known-good runtime preserved:** no dynamic-agent, state-v4, OAuth, provider-health, or other rolled-back experimental runtime code is reintroduced.
- **Version contract repaired:** `manifest.json`, the background service worker, the content-script handshake, and this README now identify the same release.
- **Repository integrity restored:** CI now checks JavaScript syntax, manifest/file references, DOM-ID contracts, message-handler coverage, and several high-risk security regressions.
- **Runaway-loop guard:** regression checks reject service-worker `setInterval` loops and unexpected unconditional `while (true)` loops while preserving the bounded stream-reader loop already used by artifact downloads.
- **No storage-schema bump:** the persisted state schema remains at version 3 because v1.15 does not change the working state shape.

## 1.11.3 historical release notes

Version 1.11.3 builds on the verified 1.10.2 release with Direct Mesh peer routing, resumable suppressed human requests, and universal role reuse.


## 1.11.2 additions

- **Direct Mesh work mode**: an AI can make a specific teammate the next speaker by ending its response with `SEND TO: AI A`, `SEND TO: AI B`, `SEND TO: AI C`, or the teammate's current label such as `SEND TO: Gemini`. Everything above that final line is the direct message. Without a routing command, Mesh falls back to the normal next-AI handoff.
- **Registered LLM command architecture**: `SEND TO` is parsed only in Direct Mesh mode and only from the final non-empty line, avoiding accidental execution when the command is discussed in prose. Unknown/self targets pause instead of silently routing to the wrong AI.
- **Suppressed request history**: Suppress keeps the human question in the saved session. The dashboard's Suppressed requests drawer can reopen it later and restore the normal answer modal.
- **Universal role history**: a saved role/job can now be applied to AI A, B, or C regardless of which AI originally used it. Existing objective/command history remains reusable globally.

## Human interaction controls

- **Send response & continue** answers the requesting AI normally.
- **Suppress request** records that the human declined to answer, closes the modal, and pauses the session without consuming an AI turn. Resume can continue later.
- **Stop session** suppresses the request and ends the run immediately so the operator can open fresh AI chats or start a new session.
- Suppression actions are written into the shared transcript, and the modal still has no silent dismiss/X.

## UI refresh

- **Blizzard Blue** is the default for new installs and now uses the actual Crayola Blizzard Blue `#ACE5EE` as the light ice canvas with dark teal `#0A3A44` body text.
- **Ghost White** adds a low-fatigue bright workspace with deep slate body text and cool lavender/blue interactive accents.
- Existing Midnight, Slate, Light, Solarized Light, Ocean, and Terminal themes remain.
- Modernized 16px cards, softer elevation, pill controls, clearer focus states, smoother hover feedback, and refined transcript/vault/runtime surfaces.
- The 40% / 60% dashboard contract and every existing DOM control ID are preserved.

# AI Bridge 1.9 — Work Modes + Human Control + Cross-AI Artifact Relay

AI Bridge is a Manifest V3 Chrome extension that coordinates a persistent 1–5-agent conversation through supported AI web interfaces.




## New in 1.9 — human control and stronger Gemini capture

- **Gemini response capture is stricter and more complete.** AI Bridge anchors on the latest top-level `model-response`, prefers the richest response-body/Markdown descendant, rejects label-only stubs such as `Gemini said`, and waits longer for Gemini to remain stable before committing the response.
- **Human-input detection is more tolerant.** The explicit `[[HUMAN_INPUT: ...]]` marker remains preferred, but the bridge now tolerates Markdown/formatting drift, scans the response tail, and recognizes clear blocking language that asks for a required decision, approval, clarification, permission, or choice. Generic optional offers do not pause the team.
- **Human attention is now modal.** When input is required, AI Bridge brings the dashboard forward and shows a centered modal with the requesting AI, its question, a response box, and queued-request count. Browser notification and extension badge remain as backup signals.
- **Human interjection is first-class.** During an active session the controller can add a correction, priority, or steering note from the dashboard. The note is recorded immediately in the shared transcript and delivered on the next safe scheduled handoff rather than interrupting an AI mid-generation. Peer Review also injects human interjections into the review prompts.

## New in 1.8 — Work Mode

AI Bridge now supports explicit work strategies from the dashboard:

- **Relay** — sequential routing through the active roster (for example A → B → C → D → E).
- **Collaborate** — sequential shared-deliverable work where each AI improves the same result.
- **Compete** — all active AIs receive the same objective simultaneously and submit independently.
- **Parallel Independent** — all active AIs work simultaneously on self-contained versions of the same objective without seeing peers during the pass.
- **Peer Review** — phase 1 collects one independent primary response from every active AI; phase 2 sends each AI the other active primary responses and collects one critique from every active AI.

Turn accounting remains response-based. A complete Compete/Parallel pass uses 3 AI turns; a complete Peer Review cycle uses 6. `-1` is still accepted, but finite settings must be large enough to complete the chosen work cycle. Parallel file capture, ZIP previews, fresh-chat controls, and human-input handling continue to work across these modes.

## New in 1.7 — start fresh AI conversations from AI Bridge

The selected AI web pages still need to be open and bound to the active logical slots, but the human no longer has to visit each site and click **New chat** manually. The dashboard now provides:

- **Start in fresh AI chats** — checked by default. Pressing **Start** resets every active selected AI tab to a new conversation, waits for each page to load, reconnects the content script, and only then sends the first bridge prompt.
- **New AI chats** — resets every active selected AI tab without starting a bridge session.
- **New chat** on each agent card — resets only that selected AI tab.

AI Bridge reuses the selected existing tabs; these controls do not create replacement AI tabs. Fresh-chat controls are disabled while a bridge session is active so an in-progress team cannot accidentally lose its provider-side context. Supported fresh-chat routes are ChatGPT, Grok, Claude, Gemini, and Microsoft Copilot.

## New in 1.6 — AI-to-AI file relay

AI Bridge now detects downloadable files produced inside an AI response, captures supported file bytes in the originating AI tab, and makes them available to the other AI chats through a persistent **Shared Vault**. This supports workflows such as ChatGPT generating a ZIP and Grok reviewing that project without the human manually downloading and re-uploading it.

The relay is hybrid by design:

- AI Bridge preserves the **original file bytes** and attempts to attach the original file to the destination AI.
- ZIP files are also inspected locally. Text/code entries using stored or DEFLATE compression are extracted into a bounded, plain-text preview.
- Text/code artifacts receive their own bounded preview.
- Those previews are included in the handoff as untrusted project data, so a provider UI change cannot block ZIP/code review merely because its native upload control changed.
- Binary-only artifacts still fail closed when a destination attachment cannot be completed; AI Bridge does not pretend an unreadable binary was shared.

Safety/performance limits remain bounded: up to 8 generated files per response, 12 MiB per file, 24 MiB combined per response, 24 retained vault files, and 60 MiB retained raw artifact data. ZIP extraction skips encrypted/unsupported/binary entries, caps individual extracted entries, and caps the text placed into any handoff. Artifact bytes live under a storage key separate from ordinary bridge/transcript state, so infinite sessions do not rewrite ZIP payloads on every state update.

The dashboard now shows a collapsible **Shared Vault** with source badges for the active AI slots, filename, size, sequence number, and status such as `Extracted`, `Raw text`, or `Raw file`. Transcript cards that produced artifacts also show **Vault Upload** chips.

ChatGPT `sandbox:/mnt/data/...` links use the authenticated conversation interpreter-download route only when the current ChatGPT conversation/message identifiers are present. Ordinary HTTP(S), blob, and data download links use direct capture.

Artifact relay does **not** increment the turn counter. `-1` remains truly infinite; only completed AI responses count as turns. Resume re-shares retained vault context with a replacement chat, while normal active-roster routing sends each side only unseen vault files.

## More themes

The existing Midnight, Slate, and Light themes are joined by:

- **Solarized Light** — warm sepia, low-eyestrain light palette.
- **Ocean** — deep navy with icy blue/cyan accents.
- **Terminal** — black/phosphor-green, sharper borders, and monospace controls.

The theme selector remains a compact dropdown and the chosen theme stays synchronized between popup and dashboard through `aiBridgeTheme`.

## New in 1.5 — wider workspace, history, and themes

The dashboard control column now uses **40% of the page width**, with the live transcript using the remaining 60%. This gives the job editors, objective, source-file controls, and history room to breathe on desktop displays.

AI Bridge now keeps two lightweight persistent history lists across sessions:

- **Previous jobs** — one combined list for all active logical AI slots, tagged by side and provider label. A previous job can be restored to any active AI role with one click.
- **Previous commands** — prior primary objectives/commands, each reusable with one click.

History is stored separately from the active relay transcript and can be cleared independently. Repeated identical entries are moved to the top instead of duplicated forever.

Three synchronized UI themes are available from both the dashboard and popup:

- **Midnight** — original near-black interface.
- **Slate** — lighter blue/gray dark theme.
- **Light** — high-contrast light workspace.

Theme choice is saved in `chrome.storage.local` and shared by the popup and dashboard.

## New in 1.5 — local code/file input

The dashboard can now attach local code without GitHub. Use **Add files**, **Add folder**, or drag files onto the Local code / files box before starting a session. AI Bridge reads text/code files locally in the extension page, stores them with the saved session, and sends the source bundle once to each AI chat. Resuming a session sends the bundle again so a replacement/new AI tab has the code context.

Safety/performance limits: up to 100 files, 200,000 characters per file, and 400,000 characters combined. Binary files are rejected; common dependency/build folders such as `.git`, `node_modules`, `.venv`, `dist`, and `build` are skipped when a folder is selected. Source is rendered and relayed as plain text.

## Dedicated application page

The full application UI is now `dashboard.html`. Chrome extension pages use the `chrome-extension://` scheme, so the dashboard is opened at runtime with:

```js
chrome.runtime.getURL("dashboard.html")
```

which resolves to:

```text
chrome-extension://<extension-id>/dashboard.html
```

Chrome reserves `chrome://` for browser-internal pages, so an extension cannot register its own `chrome://extension/page.htm` URL.

The toolbar popup is intentionally compact and opens/focuses the dashboard.

## Dashboard features

- Bind three supported AI chat tabs as AI A, AI B, and AI C.
- Assign a separate job/responsibility to every AI and reuse prior assignments from the combined job history.
- Choose the first speaker and shared primary objective, with reusable command history.
- Start, Pause, Resume, Stop, and per-agent Resend controls.
- Center-screen human-input modal plus a persistent Human interjection composer and workspace-header Interject shortcut.
- Persistent live transcript of completed AI responses and human replies.
- Transcript rendering uses plain text (`textContent`) rather than model-controlled HTML.
- Manual transcript scrolling disables auto-follow until **Jump to latest** is used.
- Runtime status shows the active agent, completed turn count, and finite/infinite limit.
- Switch between Midnight, Slate, Light, Solarized Light, Ocean, and Terminal; the popup follows the same saved theme.

## Turn limits

`Max AI turns` now accepts:

- `-1` — infinite; never stops due to turn count.
- `1` through `10000` — finite number of completed AI responses.

Values such as `0`, `-2`, `10001`, fractions, and nonnumeric input are rejected.

## Human-input safety

AI Bridge prefers an explicit `[[HUMAN_INPUT: ...]]` request near the end of an AI response, but v1.9 also recognizes formatting-drifted markers and clear blocking natural language such as needing the controller's decision, approval, clarification, permission, or required choice. The detector intentionally ignores generic optional offers (for example, asking whether the user would like an extra chart) so normal conversational endings do not constantly interrupt the workflow.

## Persistence

Session state, transcript, jobs, objective, bindings, turn cursor, and relay state are stored in `chrome.storage.local`. `unlimitedStorage` is requested so long-running/infinite sessions are not constrained by the normal local storage quota.

## Supported sites

- ChatGPT — `chatgpt.com`, `chat.openai.com`
- Grok — `grok.com`
- Claude — `claude.ai`
- Gemini — `gemini.google.com`
- Microsoft Copilot — `copilot.microsoft.com`

## Install / update

1. Extract the ZIP to a permanent folder.
2. Open `chrome://extensions/`.
3. Enable **Developer mode**.
4. For a new install, choose **Load unpacked** and select the folder containing `manifest.json`.
5. For an existing unpacked install, replace the old files and click **Reload** on the extension card.
6. Click the AI Bridge toolbar icon and choose **Open Dashboard**.
7. Open three supported AI chats, bind them in the dashboard, assign jobs, enter the objective, and start the session.

## Files

- `manifest.json` — MV3 manifest and permissions.
- `background.js` — persistent relay state, turn routing, human intervention, dashboard opening.
- `content.js` — website DOM adapters for sending prompts and detecting completed responses.
- `dashboard.html`, `dashboard.css`, `dashboard.js` — primary application UI and live output.
- `popup.html`, `popup.css`, `popup.js` — compact launcher/status controller.
- `icon128.png` — extension icon.


## v1.9 human-control improvements

- Gemini capture now prefers the full `model-response` body and richest Markdown/content descendant, while rejecting label-only stubs such as `Gemini said`.
- Human-input detection still prefers `[[HUMAN_INPUT: ...]]`, but also scans the response tail for formatting-drifted markers and clear blocking natural language asking for a decision, approval, clarification, permission, or required choice.
- Human input is shown as a centered modal dialog and the dashboard is brought forward when attention is required.
- A Human interjection box lets the controller add steering notes/corrections to the shared transcript during an active session. Interjections are delivered on the next safe scheduled handoff rather than interrupting an AI mid-generation; Peer Review also injects them into the review prompts.


## v1.11.2 controller routing refinements

- **Deferred Main-AI interjections:** the selected Main AI is the session's first-speaker selection. Human interjections are persisted immediately, but are held until that Main AI's next group turn. They are not injected into whichever secondary AI happens to be queued when the human writes the note. After Main receives the note, it becomes normal shared transcript context for later teammates.
- **Ambiguous SEND TO aliases fail closed:** duplicate or overlapping configured labels are not guessed. Use `SEND TO: AI A`, `AI B`, or `AI C` when labels are ambiguous.
- **Human replies are send-before-clear:** AI Bridge keeps the pending human question/modal state until the provider accepts the human answer, so a failed send can be retried without losing the question.

## 1.11.2 independent round timers

AI Bridge now measures each AI round itself, independently of any timing reported by the provider or LLM. The clock starts only after the browser page accepts the prompt and stops at the final observed response-text change that AI Bridge later recognizes as complete. This intentionally measures extension-observed prompt-to-response time, including network/browser/provider delivery, while excluding artifact-download time and AI Bridge's post-response file capture.

- Each AI card shows a live stopwatch while that AI has an outstanding prompt.
- Completed response transcript entries permanently store the round number and elapsed duration.
- Parallel/Compete/Review modes keep three independent clocks.
- Direct Mesh handoffs start a new clock only for the routed recipient.
- Resend starts a new numbered round.
- Active start timestamps are persisted so service-worker suspension does not reset the clock.



## 1.11.3 persistent Vault + download hardening

- `chrome.storage.local` + `unlimitedStorage` remains the durable backing store for AI-generated artifact bytes. Starting a new Bridge session no longer erases the Vault.
- Session routing now tracks `activeArtifactIds` separately, so files from an older session stay downloadable without being silently re-attached to a new session.
- Shared Vault rows have a **Download** action backed by the Chrome downloads API, plus an explicit **Clear vault** action.
- Artifact discovery now scans file/download buttons and data-URL controls as well as ordinary `<a href>` links.
- HTTP(S) artifacts that fail in page context because of CORS are retried by the extension service worker on approved provider/CDN hosts.
- Artifact capture errors are logged instead of disappearing silently, making provider DOM/download regressions debuggable.
