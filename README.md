# AI Bridge 1.5 — Dashboard, Local Files, History & Themes

AI Bridge is a Manifest V3 Chrome extension that coordinates a persistent three-AI conversation through supported AI web interfaces.


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
- Human-input intervention panel.
- Persistent live transcript of completed AI responses and human replies.
- Transcript rendering uses plain text (`textContent`) rather than model-controlled HTML.
- Manual transcript scrolling disables auto-follow until **Jump to latest** is used.
- Runtime status shows the active agent, completed turn count, and finite/infinite limit.
- Switch between Midnight, Slate, and Light themes; the popup follows the same saved theme.

## Turn limits

`Max AI turns` now accepts:

- `-1` — infinite; never stops due to turn count.
- `1` through `10000` — finite number of completed AI responses.

Values such as `0`, `-2`, `10001`, fractions, and nonnumeric input are rejected.

## Human-input safety

AI Bridge pauses for human input only when the explicit human-input request marker appears as the final non-empty line of an AI response. Ordinary prose discussing humans, application commands, stop/resume behavior, or the protocol does not trigger a pause.

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
