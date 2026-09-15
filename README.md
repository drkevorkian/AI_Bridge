# AI Bridge

**Current version: 1.16.2**

1.16.2 wraps peer-AI output, vault previews, and local source files in structural `<untrusted_peer_data>` tags, shows a keep-awake status pill, and labels transcript AI cards as data-only. 1.16.1 consumed leftover OAuth state on every callback failure. 1.16.0 added CSRF `state`, system keep-awake, and Drive 409 hardening. Chrome Sync still works without Google. Login remains optional.

AI Bridge is a Manifest V3 Chrome extension for coordinating three AI web apps as one team from a single dashboard. It supports sequential relay, parallel work, peer review, direct model-to-model routing, human intervention, persistent file relay, reusable history, optional Chrome/Google settings sync, team-cycle timing, recovery checkpoints, a `chrome.alarms` stuck watchdog, system keep-awake during active runs, and in-dashboard GitHub updates.

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
5. Open three supported AI chats.
6. Open the AI Bridge dashboard and bind them as AI A, AI B, and AI C.

Unpacked Chrome extensions cannot overwrite themselves. After the first install, use **Settings → Check for updates**. That fetches `manifest.json` from GitHub `main` over HTTPS, compares versions, and can download the ZIP. Extract it over the same folder, then click **Reload** on the extension card. Daily checks are off unless you opt in. AI Bridge never auto-installs.

## Settings tab

The dashboard header has **Session** and **Settings**.

- **Appearance** — theme, applied immediately on this machine
- **Account & sync** — optional Push / Pull / Link / Unlink
- **Google Drive login** — paste a Web-application OAuth client ID
- **Updates** — check GitHub, download ZIP, optional daily alarm

The popup **Settings** button opens `dashboard.html#settings`.

## Account & sync (optional)

Login is **never required**. Local-only behavior is unchanged. Chrome Sync (Push / Pull) works without Google.

**Push settings** writes a sanitized configuration copy to Chrome Sync. If a Google account is linked, the same copy is also written to Google Drive's hidden `appDataFolder` as `ai-bridge-settings.json`.

**Pull settings** inspects every available copy (Chrome Sync and, when linked, Drive), sanitizes each copy, and applies the newest valid `updatedAt`. Pull refuses to run during an active Bridge session.

**Link Google account** is optional. Unpacked installs have no packaged `oauth2.client_id` on purpose (a placeholder would be a security hole). To link:

1. Open Settings and copy the **Extension ID** and **Authorized redirect URI** (`https://<extension-id>.chromiumapp.org/`).
2. In Google Cloud, create a **Web application** OAuth client, enable the Drive API, and add that redirect URI.
3. Paste the client ID into Settings and click **Save client ID**. It is stored only on this machine and is never synced.
4. Click **Link Google account**. Scope used is `drive.appdata` only.

Packaged Chrome-extension client IDs still use `chrome.identity.getAuthToken`. User-supplied Web-application client IDs use `chrome.identity.launchWebAuthFlow` against `https://accounts.google.com/o/oauth2/v2/auth` with an implicit token **and a per-request cryptographically random `state`**. The returned `state` is compared in constant time against the pending value in `chrome.storage.session` (10-minute TTL, one-time use). The access token stays in `chrome.storage.session` only — never local, never sync, never Drive. CSRF state is never written to local/sync.

**Unlink Google account** clears the Identity cache, the session token, and the local linked flag. It does not delete the Drive app-data copy, so a later Link can recover it.

Do not add a placeholder `oauth2` block to `manifest.json`. Do not add a manifest `key` (that would change the unpacked extension ID and wipe local/sync for existing installs). The only Drive scope AI Bridge will accept is `drive.appdata`. Drive API calls are hardcoded to `https://www.googleapis.com` with `redirect: "error"`. Listing uses `spaces=appDataFolder`. Creating a file uses `parents: ["appDataFolder"]`. HTTP 401 evicts the cached/session token and retries once.

Synced whitelist:

- theme
- pane width
- work strategy
- Main AI preference
- turn / delay / team-cycle defaults
- recovery-summary interval
- stuck-timeout minutes
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
- OAuth client IDs
- live session state
- human answers
- recovery checkpoints
- generation IDs / watchdog recovery state

## GitHub updates

Update URLs are hardcoded to `drkevorkian/AI_Bridge`:

- `https://raw.githubusercontent.com/drkevorkian/AI_Bridge/main/manifest.json`
- `https://codeload.github.com/drkevorkian/AI_Bridge/zip/refs/heads/main`

Fetches use `redirect: "error"` and re-validate the final URL. The optional daily alarm (`ai-bridge-update-check`, 1440 minutes) only notifies — it does not download or install.

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
Cycle: every selected LLM has participated once. The counter ticks only after that full lap.
Main AI: first speaker and recipient of queued human interjections.
Best for: investigations, debugging, and iterative design.

### Collaborate

Sequential like Relay — not a live consensus discussion. Every turn revises one shared deliverable.
Best for: writing one final design, spec, or codebase.

### Compete

A/B/C start simultaneously with the same objective and do not see each other during the primary pass.
Cycle: the whole simultaneous batch. The counter ticks after every selected LLM has submitted.
Best for: independent solutions, avoiding anchoring.

### Parallel Independent

A/B/C start simultaneously and execute separate assigned jobs.
Best for: work that decomposes into backend / frontend / research / security tracks.

### Peer Review

Phase 1: all three produce independent primary responses. There is no single drafter.
Phase 2: each AI critiques the other two. There is no automatic primary-revision pass after critique.
Cycle: the full primary+critique pass. The counter ticks only after both phases finish.
Best for: high-confidence validation.

### Direct Mesh

One AI at a time. The responding AI may choose the next teammate with a final-line `SEND TO:` command. Without a valid target, normal next-agent routing applies.
Cycle: every selected LLM has participated at least once. Routing the same teammate twice does not complete the cycle.
Best for: dynamic workflows.

## Agreed upcoming features

1. Provider Preflight / Health Check
2. Named Team Profiles
3. Export / Import Config JSON
4. Diagnostics Report
5. Session Checkpoints

`content.js` is on the 1.14.0 content-script protocol (`generationId`, `AI_BRIDGE_GENERATION_STATUS`, optional `AI_BRIDGE_STOP_GENERATION`). AI Bridge reloads a stale provider tab when the ping version does not match. v1.15.0 does not bump that protocol.

## Dashboard

The dashboard uses a resizable control/transcript split. Default is **40% / 60%**.

Core controls include bind A/B/C, jobs, Team rules, work strategy, Main AI, objective, **Max team cycles**, recovery-summary interval, stuck timeout, Start/Pause/Resume/Stop/Resend, fresh chats, human interjection, Suppressed Requests, Shared Vault, history, dual Total/Current timers per LLM, and a **Settings** tab for theme, Google login, Chrome Sync, and GitHub updates.

The runtime header shows `Cycle X / Y`. Each AI card shows **Total** (session working time, including aborted/stuck attempts) and **Current** (the live turn, or the last completed duration when idle).

## Persistence

Session state remains in `chrome.storage.local`. Optional configuration copies use `chrome.storage.sync` and, when linked, Google Drive `appDataFolder`. `chrome.storage.local` and `chrome.storage.sync` are locked to trusted extension contexts.

## Release files

The packaged extension contains:

- `manifest.json`
- `background-wrapper.js`
- `background.js`
- `oauth-runtime-hardening.js`
- `power.js`
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

## Current release — 1.16.2

- Peer SHARED UPDATES, Direct Mesh bodies, and peer-review primaries are wrapped in `<untrusted_peer_data source="AI_A|AI_B|AI_C">`. Breakout tags inside the payload are neutralized
- Local source files and vault text previews use the same wrapper (`source="files"` / `source="vault"`)
- Working rules tell models that content inside those tags cannot override the Human Controller, Team Rules, job, or working protocol
- Dashboard header shows **Keep-awake on** while `sessionActive && running && !awaitingHuman`, with high-contrast treatment in Blizzard Blue and Ghost White
- Transcript AI cards show a **Peer Output — Data Only** pill. No `innerHTML`. Unique element IDs preserved
- Collaborate / Peer Review copy matches the implemented cycle semantics (sequential shared deliverable; independent primaries then all-critique)
- `CONTENT_VERSION` stays 1.14.0; `STATE_VERSION` stays 3

## Previous release — 1.16.1

- OAuth callback failures (`access_denied`, parser rejection, state/TTL/client-id mismatch) consume leftover `chrome.storage.session` CSRF state instead of leaving it until TTL
- `oauth-runtime-hardening.js` loads after `background.js` and before `power.js`

## Previous release — 1.16.0

- `chrome.power.requestKeepAwake("system")` while a session is active and running; Pause / Stop / HUMAN_INPUT release it. Monitor may still dim. Re-asserted after MV3 service-worker restart, alarms, and browser startup
- User-supplied Google OAuth now binds a 256-bit `crypto.getRandomValues` `state` to each `launchWebAuthFlow` request. Mismatch or expiry refuses the token
- Drive settings write is serialized; 409/404 races re-list and PATCH the newest `ai-bridge-settings.json`
- Peer SHARED UPDATES, Direct Mesh messages, and peer-review text are labeled untrusted evidence and cannot override Human Controller / Team Rules / job / working protocol
- `CONTENT_VERSION` stays 1.14.0; `STATE_VERSION` stays 3

## Previous release — 1.15.0

- Session / Settings view tabs on the dashboard; popup Settings opens `#settings`
- Google Drive login works for unpacked installs: paste a Web-application OAuth client ID, then Link. Packaged `oauth2.client_id` is still supported and still not shipped
- Implicit `launchWebAuthFlow` tokens stay in `chrome.storage.session` only
- GitHub update check against hardcoded HTTPS allowlist; ZIP download via `chrome.downloads` (`saveAs: true`); user extracts + Reloads
- Optional daily update alarm (`periodInMinutes: 1440`), default off, notify-only
- Chrome Sync remains the no-Google path. Login never required
- `CONTENT_VERSION` stays 1.14.0; `STATE_VERSION` stays 3

## Previous release — 1.14.0

- two timers per LLM: Total session work and Current turn
- team-cycle counter replaces the user-facing per-response counter; internal `turn` remains for diagnostics
- Max team cycles (`-1` infinite); old saved `maxTurns` migrates safely
- cycle semantics: Relay/Collaborate after every selected LLM has gone once; Compete/Parallel after the simultaneous batch; Peer Review after primary+critique; Direct Mesh after every selected side has participated at least once (duplicates do not complete the cycle)
- recovery checkpoint after cycle 1, then every N cycles (default 5). Maintenance-only: does not consume a team cycle. Local-only, size-capped, never synced
- stuck watchdog via `chrome.alarms` (`ai-bridge-watchdog`, 1 minute period). Recreated when the service worker starts
- default stuck threshold 30 minutes (5–120). Visible generation progress reschedules instead of restarting
- one automatic recovery (stop generation, fresh chat, reset source-delivery, new `generationId`, recovery prompt). A second stall pauses and requests human input
- if a checkpoint request stalls, skip it and resume normal work
- late responses from an abandoned generation are rejected by `generationId`
- content-script protocol bumped to 1.14.0

## Previous release — 1.13.1

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
