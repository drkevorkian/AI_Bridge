# AI Bridge

**Current version: 1.17.1**

AI Bridge is a Manifest V3 Chrome extension for coordinating **1–5 logical AI agents** from one dashboard. Agents may use different supported providers or multiple separate conversations from the same provider family to create independent viewpoints.

Version 1.17.1 adds the dynamic A–E agent architecture, Provider Health, same-provider multi-tab viewpoint mode, strict tab/thread isolation, queue serialization and observability, dispatch-time provenance revalidation, and the resilience regressions that protect queued, resent, replaced, failed, and delayed generations.

For the detailed same-provider security model, see [VIEWPOINT_MODE.md](VIEWPOINT_MODE.md).

## Supported providers

- ChatGPT — `chatgpt.com`, `chat.openai.com`
- Grok — `grok.com`
- Claude — `claude.ai`
- Gemini — `gemini.google.com`
- Microsoft Copilot — `copilot.microsoft.com`

Provider tabs must remain open. AI Bridge coordinates browser tabs; it does not run the models itself.

## Install / update

1. Extract the release ZIP to a permanent folder.
2. Open `chrome://extensions/`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the folder containing `manifest.json`.
5. Open the AI conversations you want to use. You may use 1–5 logical agents.
6. Open the AI Bridge dashboard, choose the agent count, and bind each active side (A–E) to a supported provider tab.

Unpacked Chrome extensions cannot overwrite themselves. After the first install, use **Settings → Check for updates**. AI Bridge fetches `manifest.json` from GitHub `main` over HTTPS, compares versions, and can download the ZIP. Extract it over the same folder, then click **Reload** on the extension card. Daily checks are optional and notify-only. AI Bridge never auto-installs.

## Dynamic agents

The dashboard supports logical sides **A, B, C, D, and E**. The active count is selectable from 1 through 5.

Each active side has independent:

- tab binding;
- assigned job;
- generation ID;
- response/provenance state;
- timers;
- resend/recovery state;
- Provider Health state.

The live side roster drives work-mode cycle semantics, recovery, routing, and dashboard visibility. A side that is not active is not part of the current cycle.

## Same-provider multi-tab viewpoints

Multiple logical agents may use the same provider family, for example Agent A and Agent D both using ChatGPT, **only** when they are bound to different Chrome tabs and different sanitized conversation threads.

Security invariants:

- one logical agent ↔ one unique Chrome tab;
- same physical tab assigned twice → `DUPLICATE_TAB` → blocked;
- same provider + different tabs + same sanitized thread → `DUPLICATE_THREAD` → blocked;
- same provider + different tabs + different sanitized threads → allowed;
- URL query strings and fragments do not create fake distinct threads;
- provider hosts must match the trusted HTTPS allowlist exactly;
- same-provider prompt dispatches serialize per provider family;
- queued sends re-resolve and revalidate tab/thread identity immediately before provider dispatch;
- queued tab navigation or closure fails closed;
- failed active dispatch clears transient viewpoint identity and disarms that side's generation;
- stale, delayed, superseded, or unarmed completions are rejected before commit.

Provider-family serialization does **not** merge side state. Agents sharing a provider remain independent logical viewpoints.

## Queue status and privacy

Same-provider queue telemetry is ephemeral service-worker memory only. It is not written to local, sync, or Drive storage.

The extension-page UI may display safe operational data such as:

- logical side;
- provider family;
- `Sending` / `Queued` state;
- relative queue position (`Queued #2`);
- approximate wait duration;
- aggregate completion/rejection counters.

Public telemetry/UI must never expose:

- raw Chrome tab IDs;
- provenance IDs;
- internal thread keys;
- full provider URLs;
- query strings or URL fragments.

Queue badges use `aria-live="polite"` and reuse the existing Health/Adaptive refresh cadence rather than creating another independent polling timer.

## Provider Health

Provider Health continuously evaluates active bindings without mutating routing.

Relevant states include:

- `READY`
- `GENERATING`
- `UNASSIGNED`
- `MISSING_TAB`
- `UNSUPPORTED`
- `UNREACHABLE`
- `DUPLICATE_TAB`
- `DUPLICATE_THREAD`

Blocking binding faults disable Start. The background dispatch path revalidates bindings again immediately before provider send, so UI manipulation cannot bypass the binding policy.

## Pause, Resume, Stop, resend, and recovery

Global **Pause** pauses orchestration/watchdog scheduling. It currently does **not** retroactively cancel provider work that was already accepted before the pause.

**Resume** continues orchestration without blanket-resetting per-side generation or provenance maps.

**Stop** ends the session-level run according to the existing runtime controls.

**Resend/replacement** is side-specific. Replacing Agent A does not reset or stop Agent D/E merely because they share the same provider family.

Automatic stuck recovery is also side-specific and uses the live A–E roster. Recovery of one side does not blanket-clear sibling same-provider state.

Service-worker restart does **not** restore or replay queued sends. Queue state is intentionally ephemeral; the next action must pass fresh binding and provenance validation.

## Team configuration

Each session has four instruction layers:

1. **Assigned job** — role-specific responsibility for each active AI.
2. **Team rules** — standing rules that bind all team members.
3. **Primary objective** — the task the team is solving now.
4. **Working rules** — AI Bridge's built-in coordination protocol.

Team rules are inserted after the team roster and before the built-in working rules. **Apply to all members** updates a live session without requiring Stop/Start.

Cloud/sync settings include the active agent count and A–E job configuration. Live tab IDs, transcripts, generation IDs, queue state, and viewpoint provenance are never synced.

## Work modes

All work modes use the currently selected live sides rather than assuming a fixed three-agent roster.

### Relay

Sequential through the active side order (for example `A → B → C → D → E`). A cycle completes after every selected side has participated once.

### Collaborate

Sequential like Relay, with each turn revising one shared deliverable. A cycle completes after every selected side has participated.

### Compete

All selected agents start the primary pass independently with the same objective. The cycle completes after the whole selected batch submits.

### Parallel Independent

All selected agents start simultaneously with their own assigned jobs. The cycle completes after the selected batch finishes.

### Peer Review

Phase 1: selected agents produce independent primary responses. Phase 2: each reviews the other selected primaries. The cycle completes after the full primary + critique pass.

### Direct Mesh

One agent at a time. The responding agent may choose the next active teammate with a final-line `SEND TO:` command. A cycle completes once every selected side has participated at least once.

## Dashboard

AI Bridge includes Classic, Studio, and Focus workspace layouts. Dynamic A–E cards are shown or hidden according to the selected agent count.

Core controls include:

- agent count and A–E tab bindings;
- assigned jobs and Team rules;
- work strategy and Main AI/start side;
- primary objective;
- Max team cycles;
- recovery-summary interval and stuck timeout;
- Start / Pause / Resume / Stop / Resend;
- fresh chats and manual relay;
- human interjection;
- Provider Health and Adaptive Selector status;
- same-provider queue badges;
- Shared Vault and file relay;
- reusable history;
- Total / Current timers per active side;
- Settings for layout, theme, sync/login, and GitHub updates.

Same-provider cards may show a sanitized conversation pathname badge when needed to distinguish viewpoints. Query/hash data is not displayed.

## Account & sync (optional)

Login is never required. Chrome Sync works without Google.

A linked Google account optionally stores the same sanitized settings copy in Drive `appDataFolder` as `ai-bridge-settings.json`. OAuth access tokens remain session-only and are never synced or stored in Drive.

Synced configuration may include:

- theme and dashboard layout;
- pane width;
- work strategy;
- Main AI/start-side preference;
- agent count;
- A–E jobs;
- turn/delay/team-cycle defaults;
- recovery-summary interval;
- stuck timeout;
- fresh-chat preference;
- Team rules;
- reusable job/command/Team-rule history.

Never synced:

- transcripts;
- Vault binaries;
- uploaded source files;
- raw tab IDs;
- OAuth tokens or OAuth client IDs;
- live session state;
- human answers;
- recovery checkpoints;
- generation IDs;
- viewpoint provenance/thread identity;
- queue telemetry/state.

## Security model highlights

AI Bridge assumes provider DOM and external content may be hostile.

Important protections include:

- trusted-extension-context authorization on privileged message endpoints;
- exact trusted HTTPS provider-host validation;
- generation-ID matching on completion;
- viewpoint provenance stamping and dispatch-time identity revalidation;
- same-family send serialization;
- stale-response rejection;
- structural wrapping of peer/file/vault data as untrusted evidence;
- HTTPS-only artifact/update fetching with redirect re-validation;
- OAuth CSRF `state` validation and session-only token storage;
- locked `chrome.storage` access for trusted extension contexts;
- fail-closed queue/tab/thread behavior.

## GitHub updates

Update URLs are hardcoded to this repository:

- `https://raw.githubusercontent.com/drkevorkian/AI_Bridge/main/manifest.json`
- `https://codeload.github.com/drkevorkian/AI_Bridge/zip/refs/heads/main`

Fetches use HTTPS, reject redirects where required, and revalidate the destination. Daily update checks are optional and never auto-install.

## Testing

Command-line tests live in `tests/`.

Run the complete portable suite with:

```text
node tests/run-all.mjs
```

The regression runner syntax-checks JS/MJS files and automatically runs top-level regression files. GitHub Actions executes the suite on Ubuntu, Windows, and macOS. A Chromium MV3 integration job also loads the unpacked extension and exercises real provider messaging paths.

Recent viewpoint regressions cover:

- dynamic 1–5 agent capability/routing/UI behavior;
- same-provider tab/thread policy;
- queue serialization, telemetry, and privacy;
- queued-navigation TOCTOU protection;
- queued tab closure cancellation;
- active-send failure cleanup;
- stale/superseded completion rejection;
- same-provider resend/replacement isolation;
- global lifecycle and side-specific recovery isolation.

## Current release — 1.17.1

Highlights:

- dynamic 1–5 logical agent roster (A–E);
- Provider Health and Adaptive Selector integration;
- same-provider multi-tab viewpoint mode with distinct-tab/distinct-thread enforcement;
- sanitized thread badges and Start blocking for conflicts;
- same-family serialization and queue observability;
- dispatch-time conversation identity pinning/revalidation;
- immediate queued-tab-close cancellation;
- active-send failure provenance/generation cleanup;
- completion-side stale/superseded generation hardening;
- side-isolated resend/replacement and recovery regressions;
- cross-platform Node regression plus Chromium MV3 integration coverage.

For deeper architecture and security details, see [VIEWPOINT_MODE.md](VIEWPOINT_MODE.md).

Older release history remains available in the Git history and tags.
