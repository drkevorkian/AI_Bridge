# AI Bridge

**Current version: 1.13.1**

1.13.0 is live on main. 1.13.1 adds the optional Google Drive `appDataFolder` write/read path on top of that release.

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

**Push settings** writes a sanitized configuration copy to Chrome Sync. If a Google account is linked, the same copy is also written to Google Drive's hidden `appDataFolder` as `ai-bridge-settings.json`.

**Pull settings** inspects every available copy (Chrome Sync and, when linked, Drive), sanitizes each copy, and applies the newest valid `updatedAt`. Pull refuses to run during an active Bridge session.

**Link Google account** uses Chrome Identity. Interactive token prompts happen only from that button. Tokens stay in Chrome's identity cache and are never written into AI Bridge storage.

**Unlink Google account** clears the Identity token cache and the local linked flag. It does not delete the Drive app-data copy, so a later Link can recover it.

Google Drive stays fail-closed until a real Chrome-extension OAuth client ID is packaged in `manifest.json`:

```json
"oauth2": {
  "client_id": "<chrome-extension-client-id>.apps.googleusercontent.com",
  "scopes": ["https://www.googleapis.com/auth/drive.appdata"]
}
```

Do not add a placeholder client ID. The only Drive scope AI Bridge will accept is `drive.appdata`. Drive API calls are hardcoded to `https://www.googleapis.com` with `redirect: "error"`. Listing uses `spaces=appDataFolder`. Creating a file uses `parents: ["appDataFolder"]`.

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

Timing: sequential `A → B → C`. One AI at a time.
Peer visibility: later AIs see accumulated shared updates.
Cycle: 3 responses make one lap.
Main AI: first speaker and recipient of queued human interjections.
Best for: investigations, debugging, and iterative design.

### Collaborate

Sequential like Relay, but every turn revises one shared deliverable.
Best for: writing one final design, spec, or codebase.

### Compete

A/B/C start simultaneously with the same objective and do not see each other during the primary pass.
Cycle: 3 independent submissions.
Best for: independent solutions, avoiding anchoring.

### Parallel Independent

A/B/C start simultaneously and execute separate assigned jobs.
Best for: work that decomposes into backend / frontend / research / security tracks.

### Peer Review

Phase 1: independent primary responses. Phase 2: each AI critiques the other two.
Cycle: 6 responses.
Best for: high-confidence validation.

### Direct Mesh

One AI at a time. The responding AI may choose the next teammate with a final-line `SEND TO:` command. Without a valid target, normal next-agent routing applies.
Best for: dynamic workflows.

## Agreed upcoming features

1. Provider Preflight / Health Check
2. Named Team Profiles
3. Export / Import Config JSON
4. Diagnostics Report
5. Session Checkpoints

`content.js` remains on the 1.11.3 content-script protocol because 1.13.x does not change provider DOM handling.

## Dashboard

The dashboard uses a resizable control/transcript split. Default is **40% / 60%**.

Core controls include bind A/B/C, jobs, Team rules, work strategy, Main AI, objective, turn limits, Start/Pause/Resume/Stop/Resend, fresh chats, human interjection, Suppressed Requests, Shared Vault, history, round timers, and optional Account & sync.

## Persistence

Session state remains in `chrome.storage.local`. Optional configuration copies use `chrome.storage.sync` and, when linked, Google Drive `appDataFolder`. `chrome.storage.local` and `chrome.storage.sync` are locked to trusted extension contexts.

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

## Current release — 1.13.1

- optional Google Drive `appDataFolder` settings file (`ai-bridge-settings.json`)
- Push writes Chrome Sync and, when linked, Drive
- Pull sanitizes every available copy and applies the newest `updatedAt`
- Link / Unlink Google account; tokens never stored by AI Bridge
- Drive API calls are HTTPS `www.googleapis.com` only, `redirect: "error"`, `drive.appdata` scope only
- HTTP 401 evicts the cached token and retries once non-interactively
- 1.13.0 security hardening retained

## Previous release — 1.13.0

- optional Chrome Sync settings push/pull (login never required)
- expanded work-strategy explanations
- HTTPS-only artifact fetch + redirect re-validation
- extension-page vs content-script message authorization
- bound-tab check for artifact fetch and inbound responses
- `chrome.storage` locked to trusted extension contexts

## Previous release — 1.12.1

- **Apply to all members** updates standing team rules on a live session
- Later A/B/C turns receive the new `TEAM RULES (ALL MEMBERS)` block without Stop/Start
- A live apply also records a human-controller transcript note
- The Team rules field stays editable during a run
