# AI Bridge

**Current version: 1.12.0**

AI Bridge is a Manifest V3 Chrome extension for coordinating three AI web apps as one team from a single dashboard. It supports sequential relay, parallel work, peer review, direct model-to-model routing, human intervention, persistent file relay, reusable history, and extension-side round timing.

## Supported providers

- ChatGPT — `chatgpt.com`, `chat.openai.com`
- Grok — `grok.com`
- Claude — `claude.ai`
- Gemini — `gemini.google.com`
- Microsoft Copilot — `copilot.microsoft.com`

The provider tabs must remain open. AI Bridge coordinates those tabs; it does not run the models itself.

## Install / update

1. Extract the release ZIP to a permanent folder.
2. Open `chrome://extensions/`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the folder containing `manifest.json`.
5. For updates, replace the extension files and click **Reload** on the extension card.
6. Open three supported AI chats.
7. Open the AI Bridge dashboard and bind them as AI A, AI B, and AI C.

## Team configuration

Each session has four separate instruction layers:

1. **Assigned job** — role-specific responsibility for each AI.
2. **Team rules** — standing rules that bind **all team members**, regardless of role.
3. **Primary objective** — the task the team is solving now.
4. **Working rules** — AI Bridge's built-in coordination protocol.

### Team rules

v1.12.0 adds a dedicated **Team rules** field between **Main AI / first speaker** and **Primary objective**.

Team rules are injected into every A/B/C prompt using this header:

```text
TEAM RULES (ALL MEMBERS):
```

They are inserted after the team roster and before the built-in working rules. They apply to every teammate regardless of assigned job or current work mode.

Examples of good Team rules:

```text
- Never publish to main until another teammate has reviewed the change.
- Preserve backwards compatibility unless the human explicitly approves a breaking change.
- Challenge any teammate's conclusion if tests or source evidence disagree.
- Keep README.md updated whenever user-visible behavior changes.
```

Behavior:

- rules are captured when **Start** is pressed
- the field locks while a session is active
- empty rules are omitted from prompts
- rules survive pause/resume and normal state recovery
- previous rule sets are stored separately from jobs and objectives
- saved rules can be reused from **Previous team rules**
- rule history is capped and de-duplicated

## Dashboard

The dashboard uses a resizable control/transcript split. Default is **40% / 60%**.

Core controls include:

- bind AI A / B / C to open provider tabs
- assign a separate role to each AI
- set Team rules for all members
- choose the Main AI / first speaker
- choose a work mode
- set the primary objective
- finite or infinite turn limits
- Start / Pause / Resume / Stop / Resend
- Human interjection
- Suppressed Requests
- Shared Vault
- reusable role, command, and Team-rule history
- extension-side round timers

The divider can be dragged, adjusted with the keyboard, or reset to 40%. Its width is remembered.

## Work modes

### Relay

Normal sequential handoff:

`A → B → C → A ...`

### Collaborate

Sequential shared-deliverable mode. Each AI improves the same result using its assigned role.

### Compete

A, B, and C receive the same objective simultaneously and respond independently.

### Parallel Independent

A, B, and C work simultaneously on independent or complementary tasks.

### Peer Review

Two-phase mode:

1. all three produce independent primary responses
2. each AI receives the other two primary responses and critiques them

A complete cycle uses six AI responses.

### Direct Mesh

One AI speaks at a time but may explicitly choose the next teammate by placing a routing command on the final non-empty line:

```text
SEND TO: Gemini
```

or:

```text
SEND TO: AI C
```

Accepted targets include AI A/B/C and unambiguous configured labels. Ambiguous or self-targeted aliases fail closed. Without `SEND TO:`, Mesh uses the normal next-AI route.

## Human control

### Human-input requests

Preferred explicit marker:

```text
[[HUMAN_INPUT: specific question for the human]]
```

AI Bridge can also detect clear blocking requests near the end of an AI response.

When human input is required, the dashboard shows a centered modal with:

- **Send response & continue**
- **Suppress request**
- **Stop session**

Suppressed questions remain available in the **Suppressed Requests** drawer and can be reopened later with **Answer**.

Human replies use send-before-clear behavior, so a failed provider send does not discard the pending question.

### Human interjections

Interjections are recorded immediately but wait for the configured **Main AI**. They are delivered on that model's next turn rather than to whichever secondary AI happens to be queued.

## Turn limits

`Max AI turns` accepts:

- `-1` — infinite
- `1` through `10000` — finite completed AI responses

Human replies, interjections, pauses, file relay, and suppression actions do not consume AI turns.

Minimum finite cycles:

- Compete / Parallel: 3
- Peer Review: 6

## Independent round timers

AI Bridge measures each model round independently of provider-reported timing.

- clock starts after the provider accepts the prompt
- clock stops at the final response-text change recognized as complete
- active timers survive service-worker suspension
- Parallel / Compete / Review keep separate A/B/C clocks
- Resend starts a new numbered round
- Direct Mesh starts a timer only for the routed recipient

Transcript metadata uses the form:

```text
R3 · 42.1s
```

Artifact download/post-processing time is excluded.

## Shared Vault and file relay

AI-generated artifact bytes are retained in a persistent Shared Vault.

The Vault survives:

- Manifest V3 service-worker suspension
- browser restarts
- Stop / Start
- fresh provider chats
- new Bridge sessions

Old files remain downloadable but are not automatically attached to a new project. Current-session routing is tracked separately.

Vault controls include:

- **Download**
- **Clear vault**

Artifact capture supports normal links, download buttons, rendered file controls, common `data-*` URL attributes, HTTP(S), blob/data URLs, and supported ChatGPT interpreter downloads.

If page-context fetching fails because of CORS, AI Bridge can retry through the extension service worker on approved provider/CDN hosts. Capture failures are logged instead of disappearing silently.

### ZIP handling

ZIPs retain their original binary bytes while AI Bridge also performs bounded local inspection of text/code entries.

Current limits:

- 8 artifacts per AI response
- 12 MiB per artifact
- 24 MiB combined per response
- 24 retained Vault files
- 60 MiB retained raw Vault data

## Local source files

Before starting a session, the dashboard can load local code/files using **Add files**, **Add folder**, or drag-and-drop.

Limits:

- 100 source files
- 200,000 characters per file
- 400,000 characters combined

Binary source files are rejected. Common dependency/build folders such as `.git`, `node_modules`, `.venv`, `dist`, and `build` are ignored when loading folders.

Local source is treated as project data and must not override the human objective or Team rules.

## Fresh-chat controls

AI Bridge can reset provider conversations without requiring manual navigation to each site.

- **Start in fresh AI chats**
- **New AI chats** — reset all three selected providers
- **New chat** — reset one provider

Fresh-chat controls stay locked while a resumable session remains attached to the current provider conversations.

## History

AI Bridge keeps reusable history separate from the live transcript:

- previous roles — reusable on any A/B/C slot
- previous objectives / commands
- previous Team rules

Repeated identical history entries are promoted instead of endlessly duplicated.

## Themes

- Blizzard Blue — default, `#ACE5EE`
- Ghost White
- Midnight
- Slate
- Light
- Solarized Light
- Ocean
- Terminal

Theme choice is stored in `chrome.storage.local` and shared by dashboard and popup. Motion-sensitive users are respected through `prefers-reduced-motion`.

## Persistence

Session state is stored in `chrome.storage.local`, including:

- AI bindings and labels
- roles
- Team rules
- objective
- transcript
- active / paused session state
- work-mode phase state
- turn cursor and limits
- suppressed human requests
- history
- timer state
- persistent Vault metadata and bytes

`unlimitedStorage` is requested for long-running sessions and binary artifact retention.

## Release files

The extension contains exactly 11 release files:

- `manifest.json`
- `background.js`
- `content.js`
- `dashboard.html`
- `dashboard.css`
- `dashboard.js`
- `popup.html`
- `popup.css`
- `popup.js`
- `README.md`
- `icon128.png`

## Current release — 1.12.0

- standing Team rules for all members
- Team rules injected into every prompt path built through `teamContext()`
- independent Team-rule history with Use / Clear controls
- active-session lock for Team rules
- resizable dashboard panes retained from 1.11.4
- persistent Vault, Direct Mesh, resumable human requests, Main-AI interjections, and independent round timers retained from 1.11.x

`content.js` remains on the 1.11.3 content-script protocol because 1.12.0 does not change provider DOM handling.