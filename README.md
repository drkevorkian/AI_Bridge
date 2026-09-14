# AI Bridge

**Current version: 1.11.3**

> GitHub commit [`f34778f`](https://github.com/drkevorkian/AI_Bridge/commit/f34778f81f9362ef0ad2c03933011e41d3c9fe36) was accidentally titled `1.13`. That was a **label typo only**. The shipped extension version is **1.11.3**.

AI Bridge is a Manifest V3 Chrome extension for coordinating three AI web apps as a team from one dashboard. It can relay work sequentially, run multiple models in parallel, let models review each other, route messages directly between specific models, pause for human decisions, and persist generated files in a shared artifact vault.

## What it does

AI Bridge binds three open AI tabs as **AI A**, **AI B**, and **AI C**. Each AI can have its own role while all three work from the same primary objective.

Supported providers:

- ChatGPT — `chatgpt.com`, `chat.openai.com`
- Grok — `grok.com`
- Claude — `claude.ai`
- Gemini — `gemini.google.com`
- Microsoft Copilot — `copilot.microsoft.com`

The AI webpages must remain open in browser tabs. AI Bridge reuses those tabs rather than running the models itself.

## Install / update

1. Extract the release ZIP to a permanent folder.
2. Open `chrome://extensions/`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the folder containing `manifest.json`.
5. For an update, replace the files in that folder and click **Reload** on the extension card.
6. Open three supported AI chats.
7. Click the AI Bridge extension and open the dashboard.
8. Bind the three tabs to AI A, B, and C, assign roles, choose a work mode, enter the objective, and press **Start**.

## Dashboard

The dashboard uses a 40% control pane and 60% live transcript pane.

Core controls include:

- bind AI A / B / C to open supported tabs
- assign a separate role to each AI
- choose the Main AI / first speaker
- set the primary objective
- choose a work mode
- configure finite or infinite turn limits
- Start, Pause, Resume, Stop, Resend
- start in fresh provider chats
- reset one AI chat or all three AI chats
- Human interjection composer
- Suppressed Requests drawer
- Shared Vault for AI-generated files
- reusable role and objective history
- per-AI extension-side round timers

The transcript is rendered as plain text rather than model-controlled HTML.

## Work modes

### Relay

Normal sequential handoff:

`A → B → C → A ...`

Each AI receives the shared history and builds on the previous work.

### Collaborate

Sequential shared-deliverable mode. Each AI improves the same result using its assigned role.

### Compete

All three AIs receive the same objective at the same time and answer independently.

### Parallel Independent

All three AIs work simultaneously on independent versions or complementary tasks.

### Peer Review

Two-phase mode:

1. A, B, and C produce independent primary responses.
2. Each AI receives the other two primary responses and critiques them.

A complete review cycle uses six AI responses.

### Direct Mesh

One AI speaks at a time, but it can explicitly choose the next teammate.

Put a routing command on the **final non-empty line** of the response:

```text
SEND TO: Gemini
```

or:

```text
SEND TO: AI C
```

Accepted targets include `AI A`, `AI B`, `AI C`, and the configured provider/role labels when they resolve unambiguously.

If `SEND TO:` is absent, Mesh falls back to the normal next-AI route.

Ambiguous or self-targeted aliases fail closed instead of guessing.

## Human control

### Human-input requests

AI Bridge prefers the explicit marker:

```text
[[HUMAN_INPUT: specific question for the human]]
```

It also recognizes clear blocking requests near the end of a response when an AI genuinely needs a decision, approval, clarification, permission, or required choice.

When human input is required, AI Bridge opens a centered modal.

Available actions:

- **Send response & continue** — answer the requesting AI
- **Suppress request** — store the question and pause without consuming an AI turn
- **Stop session** — suppress the request and end the run so fresh chats / a new session are immediately available

Suppressed questions are retained in the **Suppressed Requests** drawer. Use **Answer** later to reopen the original request and continue from the AI that asked it.

Human replies use send-before-clear behavior: the pending request is not discarded until the provider accepts the answer.

### Human interjections

Human interjections are recorded immediately but are **not injected into whichever AI happens to be speaking next**.

They wait for the configured **Main AI** (the first-speaker selection) and are delivered on that model's next turn. After Main receives the interjection, it becomes part of normal shared context for later teammates.

## Turn limits

`Max AI turns` accepts:

- `-1` — infinite
- `1` through `10000` — finite completed AI responses

Turn accounting is response-based. Human replies, interjections, pauses, file relay, and suppression actions do not consume AI turns.

Batch modes require enough finite turns to complete a cycle:

- Compete / Parallel: minimum 3
- Peer Review: minimum 6

## Independent round timers

AI Bridge measures model round time itself rather than trusting provider- or model-reported timing.

For each AI:

- the timer starts after the provider page accepts the prompt
- the timer stops at the final observed response-text change that AI Bridge later recognizes as complete
- active timers survive service-worker suspension
- Parallel / Compete / Review maintain separate clocks for A, B, and C
- Resend starts a new numbered round
- Direct Mesh starts a timer only for the routed recipient

Completed transcript entries retain metadata such as:

```text
R3 · 42.1s
```

Artifact downloading and post-response file processing are intentionally excluded from the measured LLM round time.

## Shared Vault and file relay

AI Bridge can capture files generated by one AI and make them available to the others.

The Shared Vault stores the **original file bytes**, not just filenames or text summaries.

### Persistence

Artifact bytes are stored separately in `chrome.storage.local` under persistent extension storage. `unlimitedStorage` is requested so long-running sessions and retained binary files are not constrained by the normal local-storage quota.

The Vault survives:

- Manifest V3 service-worker suspension
- browser restarts
- Stop / Start
- fresh provider conversations
- new AI Bridge sessions

Starting a new session does **not** erase the Vault.

Old Vault files remain downloadable, but AI Bridge tracks current-session files separately so old artifacts are not silently re-attached to a new project.

### Downloads

Each Vault entry has a **Download** action backed by Chrome's downloads API.

The Vault also has an explicit **Clear vault** control for intentionally deleting retained artifact bytes.

### Artifact capture

AI Bridge detects downloadable artifacts from:

- normal download links
- file/download buttons
- rendered artifact controls
- `data-download-url`
- `data-file-url`
- `data-url`
- `data-href`
- HTTP(S), blob, and data URLs
- supported ChatGPT interpreter/sandbox download links when conversation metadata is available

If an HTTP(S) download fails in page context because of CORS, AI Bridge can retry through the extension service worker on approved provider/CDN hosts.

Capture failures are logged instead of disappearing silently.

### ZIP handling

ZIP files keep their original binary bytes while AI Bridge also attempts a bounded local inspection of text/code entries.

Supported ZIP preview behavior includes:

- stored and DEFLATE entries
- text/code file detection
- binary-entry rejection
- encrypted/unsupported entry skipping
- bounded decompression and preview size limits

This allows another AI to inspect source inside a ZIP even when a provider's native attachment UI is temporarily unavailable.

Binary-only artifacts still fail closed if they cannot actually be attached to the destination provider.

### File limits

Current artifact limits:

- up to 8 generated artifacts per AI response
- up to 12 MiB per artifact
- up to 24 MiB combined artifact data per response
- up to 24 retained Vault files
- up to 60 MiB retained raw Vault data

## Local source files

The dashboard can also load local source/code directly before a session.

Use **Add files**, **Add folder**, or drag files into the source area.

Limits:

- up to 100 source files
- up to 200,000 characters per file
- up to 400,000 characters combined

Binary source files are rejected. Common dependency/build directories such as `.git`, `node_modules`, `.venv`, `venv`, `__pycache__`, `.next`, `dist`, and `build` are ignored when loading folders.

Local source is treated as untrusted project data, not as instructions that override the human objective or team rules.

## Fresh-chat controls

AI Bridge can reset provider conversations without requiring the human to visit each AI tab manually.

Available controls:

- **Start in fresh AI chats**
- **New AI chats** — reset all three selected providers
- **New chat** — reset one selected provider

AI Bridge reuses the existing selected tabs.

Fresh-chat controls stay locked while a resumable active session is still attached to the existing conversations.

## Role and command history

AI Bridge stores reusable history separately from the active transcript.

- prior roles can be applied to **any** of A, B, or C, regardless of which AI originally used the role
- previous primary objectives can be reused from command history
- duplicate history entries are de-duplicated / promoted rather than endlessly repeated

## Themes

Current themes:

- **Blizzard Blue** — default; `#ACE5EE` ice canvas with dark teal text
- **Ghost White** — bright low-fatigue workspace
- Midnight
- Slate
- Light
- Solarized Light
- Ocean
- Terminal

The selected theme is stored in `chrome.storage.local` and shared between the dashboard and popup.

Motion-sensitive users are respected through `prefers-reduced-motion`; active timer indicators remain visible without requiring pulsing animation.

## Persistence model

AI Bridge stores session state in `chrome.storage.local`, including:

- active / paused session state
- transcript
- AI bindings and labels
- roles
- objective
- turn cursor and limits
- work-mode phase state
- suppressed human requests
- history
- round-timer state
- persistent Vault metadata and file bytes

This allows a Manifest V3 service worker to unload and later recover the bridge state.

## Files

The release contains exactly 11 extension files:

- `manifest.json` — MV3 manifest, permissions, host permissions
- `background.js` — state machine, routing, persistence, artifact store, human control, timers
- `content.js` — provider DOM adapters, prompt sending, response detection, uploads/download capture
- `dashboard.html`
- `dashboard.css`
- `dashboard.js`
- `popup.html`
- `popup.css`
- `popup.js`
- `README.md`
- `icon128.png`

## Current release notes — 1.11.3

**This release is 1.11.3.** An earlier GitHub commit on this line was accidentally titled `1.13`; that was a label typo only. The shipped extension version is `1.11.3`.

1.11.3 hardens the artifact system:

- Vault artifacts now persist across new Bridge sessions instead of being erased on Start
- current-session artifact routing is separated from retained Vault history
- Vault entries can be downloaded directly
- Vault can be intentionally cleared
- artifact detection now includes buttons/data-backed controls as well as anchors
- provider-page CORS failures can retry through the extension service worker on approved hosts
- artifact capture failures are surfaced in logs instead of silently disappearing
- dashboard and popup show a `v1.11.3` badge so the accidental `1.13` commit title cannot be mistaken for the shipped version
- Start / Pause / Resume / Stop use local Lucide-style SVG icons (no CDN)
- popup Open Dashboard / Pause / Stop use matching local Lucide-style SVG icons
- the compact popup shows live extension round clocks while an AI is generating

It also retains the Direct Mesh routing, resumable suppressed human requests, universal role reuse, Main-AI deferred interjections, send-before-clear human replies, and extension-side round timers introduced in the 1.11.x series.
