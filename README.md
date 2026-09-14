# AI Bridge 1.10 — Modern UI + Blizzard Blue / Ghost White

This UI-only release is layered on the working v1.9 runtime. It does **not** change relay, Work Mode, file vault, Gemini capture, fresh-chat, human-input, or interjection logic.

## UI refresh

- **Blizzard Blue** is the default for new installs: ice-navy canvas, frost-white long-form text, and Blizzard Blue `#ACE5EE` interactive accents.
- **Ghost White** adds a low-fatigue bright workspace with deep slate body text and cool lavender/blue interactive accents.
- Existing Midnight, Slate, Light, Solarized Light, Ocean, and Terminal themes remain.
- Modernized 16px cards, softer elevation, pill controls, clearer focus states, smoother hover feedback, and refined transcript/vault/runtime surfaces.
- The 40% / 60% dashboard contract and every existing DOM control ID are preserved.

# AI Bridge 1.9 — Work Modes + Human Control + Cross-AI Artifact Relay

AI Bridge is a Manifest V3 Chrome extension that coordinates a persistent three-AI conversation through supported AI web interfaces.




## New in 1.9 — human control and stronger Gemini capture

- **Gemini response capture is stricter and more complete.** AI Bridge anchors on the latest top-level `model-response`, prefers the richest response-body/Markdown descendant, rejects label-only stubs such as `Gemini said`, and waits longer for Gemini to remain stable before committing the response.
- **Human-input detection is more tolerant.** The explicit `[[HUMAN_INPUT: ...]]` marker remains preferred, but the bridge now tolerates Markdown/formatting drift, scans the response tail, and recognizes clear blocking language that asks for a required decision, approval, clarification, permission, or choice. Generic optional offers do not pause the team.
- **Human attention is now modal.** When input is required, AI Bridge brings the dashboard forward and shows a centered modal with the requesting AI, its question, a response box, and queued-request count. Browser notification and extension badge remain as backup signals.
- **Human interjection is first-class.** During an active session the controller can add a correction, priority, or steering note from the dashboard. The note is recorded immediately in the shared transcript and delivered on the next safe scheduled handoff rather than interrupting an AI mid-generation. Peer Review also injects human interjections into the review prompts.

## New in 1.8 — Work Mode

AI Bridge now supports explicit work strategies from the dashboard:

- **Relay** — the original sequential A → B → C workflow.
- **Collaborate** — sequential shared-deliverable work where each AI improves the same result.
- **Compete** — all three AIs receive the same objective simultaneously and submit independently.
- **Parallel Independent** — all three AIs work simultaneously on self-contained versions of the same objective without seeing peers during the pass.
- **Peer Review** — phase 1 collects three independent primary responses; phase 2 sends each AI the other two primary responses and collects three critiques.

Turn accounting remains response-based. A complete Compete/Parallel pass uses 3 AI turns; a complete Peer Review cycle uses 6. `-1` is still accepted, but finite settings must be large enough to complete the chosen work cycle. Parallel file capture, ZIP previews, fresh-chat controls, and human-input handling continue to work across these modes.

## New in 1.7 — start fresh AI conversations from AI Bridge

The three AI web pages still need to be open and selected as AI A, B, and C, but the human no longer has to visit each site and click **New chat** manually. The dashboard now provides:

- **Start in fresh AI chats** — checked by default. Pressing **Start** resets all three selected AI tabs to new conversations, waits for each page to load, reconnects the content script, and only then sends the first bridge prompt.
- **New AI chats** — resets all three selected AI tabs without starting a bridge session.
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

The dashboard now shows a collapsible **Shared Vault** with AI A/B/C source badges, filename, size, sequence number, and status such as `Extracted`, `Raw text`, or `Raw file`. Transcript cards that produced artifacts also show **Vault Upload** chips.

ChatGPT `sandbox:/mnt/data/...` links use the authenticated conversation interpreter-download route only when the current ChatGPT conversation/message identifiers are present. Ordinary HTTP(S), blob, and data download links use direct capture.

Artifact relay does **not** increment the turn counter. `-1` remains truly infinite; only completed AI responses count as turns. Resume re-shares the retained vault context with a replacement chat, while normal A → B → C routing sends each side only unseen vault files.

## More themes

The existing Midnight, Slate, and Light themes are joined by:

- **Solarized Light** — warm sepia, low-eyestrain light palette.
- **Ocean** — deep navy with icy blue/cyan accents.
- **Terminal** — black/phosphor-green, sharper borders, and monospace controls.

The theme selector remains a compact dropdown and the chosen theme stays synchronized between popup and dashboard through `aiBridgeTheme`.

## New in 1.5 — wider workspace, history, and themes

The dashboard control column now uses **40% of the page width**, with the live transcript using the remaining 60%. This gives the job editors, objective, source-file controls, and history room to breathe on desktop displays.

AI Bridge now keeps two lightweight persistent history lists across sessions:

- **Previous jobs** — one combined list for AI A, B, and C, tagged by side and provider label. A previous job can be restored to the same AI role with one click.
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
