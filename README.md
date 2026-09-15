# AI Bridge

**Current version: 1.13.0 (workstream — not yet on main)**

AI Bridge is a Manifest V3 Chrome extension for coordinating three AI web apps as one team from a single dashboard. It supports sequential relay, parallel work, peer review, direct model-to-model routing, human intervention, persistent file relay, reusable history, optional Chrome/Google settings sync, and extension-side round timing.

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

## Account & sync (optional)

Login is **never required**. Local-only behavior is unchanged.

**Push settings** / **Pull settings** copy configuration through Chrome Sync when you are signed into Chrome. This is the working cross-profile path today.

**Link Google account** is the future Google Drive `appDataFolder` path. It stays disabled-by-architecture until a real Google Cloud OAuth client ID is packaged in `manifest.json` (`oauth2.client_id`). No placeholder client ID is shipped. Tokens stay in Chrome's identity cache and are never written into AI Bridge storage.

Synced whitelist:

- theme
- pane width
- work strategy
- Main AI preference
- turn / delay defaults
- fresh-chat preference
- A/B/C jobs
- Team rules
- reusable job / command / Team-rule history

Never synced:

- transcripts
- Vault binaries
- uploaded source files
- tab IDs
- OAuth tokens
- live session state
- human answers

Pull refuses to run during an active session so a cloud copy cannot overwrite a live run.

## Team configuration

Each session has four separate instruction layers:

1. **Assigned job** — role-specific responsibility for each AI.
2. **Team rules** — standing rules that bind **all team members**, regardless of role.
3. **Primary objective** — the task the team is solving now.
4. **Working rules** — AI Bridge's built-in coordination protocol.

Team rules are injected into every A/B/C prompt using:

```text
TEAM RULES (ALL MEMBERS):
```

They are inserted after the team roster and before the built-in working rules. **Apply to all members** updates a live session without Stop/Start.

## Work modes

Each strategy is defined by timing, peer visibility, cycle size, Main AI meaning, and best use.

### Relay

- Timing: sequential A → B → C. One AI at a time.
- Peer visibility: every later AI sees accumulated shared updates and continues the same problem.
- Cycle: 3 responses make one lap.
- Main AI: first speaker, and the recipient of queued human interjections.
- Best for: investigations, debugging, and iterative design.

### Collaborate

- Timing: sequential like Relay.
- Peer visibility: later AIs revise one shared deliverable.
- Cycle: 3 responses make one lap of the shared artifact.
- Main AI: first speaker + queued interjections.
- Best for: one final design, spec, or codebase.

### Compete

- Timing: A, B, and C start simultaneously.
- Peer visibility: they do not see each other during the primary pass.
- Cycle: 3 independent submissions.
- Main AI: recipient of queued interjections.
- Best for: independent solutions, avoiding anchoring.

### Parallel Independent

- Timing: A, B, and C start simultaneously.
- Peer visibility: each executes its assigned job rather than solving the identical problem three times.
- Cycle: 3 parallel job completions.
- Main AI: queued interjections.
- Best for: work that decomposes into backend / frontend / research / security tracks.

### Peer Review

- Timing: two simultaneous phases.
- Peer visibility: phase 1 independent; phase 2 each AI receives the other two results and critiques them.
- Cycle: 6 responses (3 primary + 3 critiques).
- Main AI: queued interjections.
- Best for: high-confidence validation and catching mistakes or bias.

### Direct Mesh

- Timing: one AI at a time.
- Peer visibility: accumulated shared updates, then an optional explicit handoff.
- Cycle: 1 response per handoff. Put `SEND TO: AI A|B|C` (or an unambiguous label) on the final non-empty line. Without a valid target, normal next-agent routing applies.
- Main AI: first speaker unless a prior handoff changed the cursor, plus queued interjections.
- Best for: dynamic workflows where the right next specialist depends on what was just discovered.

## Human control

Preferred explicit marker:

```text
[[HUMAN_INPUT: specific question for the human]]
```

Modal actions: **Send response & continue**, **Suppress request**, **Stop session**.

Interjections wait for the configured **Main AI** and are delivered on that model's next group turn.

## Security notes for 1.13.0

- Artifact background fetch is HTTPS-only. HTTP, embedded credentials, and `javascript:` / `data:` URLs fail closed.
- `redirect: follow` re-validates `response.url` against the same HTTPS allowlist.
- Privileged messages (`START`, `GET_STATE`, Vault download, Team rules, cloud ops, …) are restricted to extension pages (dashboard / popup).
- Content scripts may send only `AI_BRIDGE_FETCH_ARTIFACT` and `AI_BRIDGE_RESPONSE`.
- Artifact fetch and inbound responses require an active session and a currently bound A/B/C tab.
- `chrome.storage.local` and `chrome.storage.sync` are locked to `TRUSTED_CONTEXTS` so provider-page scripts cannot read transcripts, Vault bytes, or synced settings.
- Chrome Sync settings are chunked under the 8 KB per-item quota.

`content.js` remains on the 1.11.3 content-script protocol because 1.13.0 does not change provider DOM handling.

## Dashboard

The dashboard uses a resizable control/transcript split. Default is **40% / 60%**.

Core controls include bind A/B/C, jobs, Team rules, work strategy, Main AI, objective, turn limits, Start/Pause/Resume/Stop/Resend, fresh chats, human interjection, Suppressed Requests, Shared Vault, history, round timers, and optional Account & sync.

## Persistence

Session state remains in `chrome.storage.local`. Optional configuration copies use `chrome.storage.sync`. Google Drive `appDataFolder` is the planned explicit Google-account path once the human supplies an OAuth client ID.

## Release files

The packaged extension contains:

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

Command-line tests live in `tests/`.

## Current release — 1.13.0

- optional Chrome Sync settings push/pull (login never required)
- Google account button present, fail-closed until a real OAuth client ID is packaged
- expanded work-strategy explanations (timing, visibility, cycle, Main AI, best use)
- HTTPS-only artifact fetch + redirect re-validation
- extension-page vs content-script message authorization
- bound-tab check for artifact fetch and inbound responses
- `chrome.storage` locked to trusted extension contexts
- live Apply team rules retained from 1.12.1

## Previous release — 1.12.1

- **Apply to all members** updates standing team rules on a live session
- Later A/B/C turns receive the new `TEAM RULES (ALL MEMBERS)` block without Stop/Start
- A live apply also records a human-controller transcript note
- The Team rules field stays editable during a run
