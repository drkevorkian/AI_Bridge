# AI Bridge — Human Test Build 1.19.1.08-AI-A

This directory is the current runnable **human-test build** of AI Bridge.

Load **this folder** as an unpacked Chrome extension when testing fixes that have not yet been promoted to the repository root.

## Build identity

- Chrome extension version: **1.19.1**
- AI Bridge build: **1.19.1.08-AI-A**
- Package: `AI_INPUT/`
- Workspace: **Classic**
- Active agent slots: **1–5**
- Work modes: Relay, Collaborate, Compete, Parallel Independent, Peer Review, Direct Mesh

The manifest `version_name` is the source of truth for the build label shown by the extension.

## Load it in Chrome

1. Pull the latest repository state.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the repository's **`AI_INPUT`** folder.
6. Confirm the extension reports **`1.19.1.08-AI-A`**.
7. Open the AI provider conversations you want to use.
8. Refresh those provider tabs once after loading/reloading the extension.
9. Open the AI Bridge Dashboard and bind each AI role to its provider tab.

Refreshing provider tabs matters because an already-injected content script can otherwise remain from the previous build.

## What to test in 1.19.1.08-AI-A

This build is primarily a durable relay/recovery test build.

The important fixes include:

- transaction-scoped recovered next-turn handling;
- restart recovery for already-confirmed sends;
- content-side action proof after a Manifest V3 service-worker restart;
- continuation-source provenance;
- cross-session stale dispatch isolation;
- automatic cleanup of orphaned `CREATED` dispatches;
- exact blocker diagnostics when replay remains unsafe;
- ChatGPT conditional Send-button DOM handling;
- provider error correlation without blind automatic resend.

The recovery work is intended to eliminate false pauses such as:

```text
UNRESOLVED_DISPATCH_BLOCKS_REPLAY
```

when the blocker belongs to an older/unrelated relay transaction.

If replay is still blocked in this build, the error should include the exact blocker details:

```text
UNRESOLVED_DISPATCH_BLOCKS_REPLAY:<STATUS>:<dispatch-id>:source=<source-id>
```

That detail is useful evidence. Please preserve it in bug reports.

## Normal relay test

A useful basic test sequence is:

1. bind three provider tabs to AI A/B/C;
2. choose Relay mode;
3. start with a short objective;
4. verify A → B → C progression;
5. pause and resume;
6. verify the next AI receives the prompt exactly once;
7. reload the extension while a response is pending;
8. resume and verify AI Bridge adopts/reconciles the existing dispatch instead of replaying it.

When testing recovery, note whether the provider received the prompt:

- zero times;
- exactly once;
- more than once.

Exactly-once behavior is the goal.

## Multi-agent / same-provider test

AI Bridge supports 1–5 active roles.

Multiple roles may use the same provider as long as each role is assigned a different browser tab.

Example:

```text
AI A → ChatGPT tab 1
AI B → ChatGPT tab 2
AI C → Grok tab 1
```

This is expected and should not be treated as a duplicate-provider error.

## Work modes

### Relay

Sequential AI A → AI B → AI C → ... handoff.

### Collaborate

Sequential shared-deliverable mode. Each AI improves the same result from its assigned specialty.

### Compete

All active AIs receive the same objective simultaneously and answer independently.

### Parallel Independent

All active AIs work simultaneously and independently.

### Peer Review

Primary independent answers first, followed by a simultaneous critique/review phase.

### Direct Mesh

Sequential mode where an AI may route directly to another active teammate using a final line such as:

```text
SEND TO: AI C
```

## Human controller behavior

AI Bridge supports explicit human-input requests.

Preferred marker:

```text
[[HUMAN_INPUT: your question to the human]]
```

When recognized, the session pauses and the Dashboard opens the human-response workflow.

The Dashboard also supports queued human interjection for the configured Main AI.

## Provider surfaces

The extension recognizes:

- ChatGPT
- Grok
- Gemini
- Claude
- Microsoft Copilot

Trusted relay capability varies by provider and current provider DOM.

The Dashboard health status is more authoritative than the provider name alone. If trusted controls cannot be proven, AI Bridge should fail closed rather than guess.

## ChatGPT DOM authority behavior

Current ChatGPT can omit or disable its Send control while the composer is empty.

The current send sequence therefore verifies the composer first, inserts the draft, waits for the trusted Send control to become available/actionable, re-verifies conversation authority, and only then clicks.

Expected failures now distinguish phases such as:

```text
DOM_AUTHORITY_UNAVAILABLE: COMPOSER
DOM_AUTHORITY_NOT_ACTIONABLE: SEND
DOM_AUTHORITY_CHANGED: COMPOSER
DOM_AUTHORITY_CHANGED: SEND
```

## Durable recovery model

The human-test runtime persists relay state across Manifest V3 service-worker restarts.

Important states include:

```text
CREATED
DISPATCHING
ACCEPTED
AWAITING_RESPONSE
RESPONSE_COMMITTED
DELIVERY_AMBIGUOUS
FAILED
```

Key rules:

- `CREATED` means no provider action was attempted and may be safely retired if orphaned.
- `ACCEPTED` means provider action was confirmed.
- `AWAITING_RESPONSE` must not be blindly resent.
- ambiguous delivery remains fail-closed unless exact content-side proof exists.
- a new Bridge session resets stale durable relay state from the previous inactive session.
- unrelated older continuation records must not poison the current recovered turn.

## Provider errors

Operational provider messages are not treated as AI responses.

Examples include:

- delivery timeout;
- network interruption;
- generation errors;
- rate or usage limits;
- authentication requirements.

When delivery may have occurred but cannot be proven, AI Bridge pauses rather than automatically duplicating the prompt.

## Conversation max-length rollover

ChatGPT max-length detection is present.

The current build recognizes the authoritative conversation-length warning and excludes generic rate/usage/network errors.

However, automatic trusted New Chat/thread rollover is still **LIMITED**.

Current expected behavior is to pause when the authoritative thread limit is detected rather than navigate/click using untrusted broad DOM automation.

Grok automatic hard-limit rollover is also still fail-closed until a trustworthy provider-specific signature is verified.

## Sources and Vault

The Dashboard supports local source files and maintains job/command history.

The Vault/artifact subsystem is present, but provider-side artifact extraction and trusted upload authority remain **LIMITED**.

Do not assume every provider can automatically transfer generated files between AI tabs.

## Themes

The current color themes are:

- Blizzard
- Ghostwhite
- Midnight
- Slate
- Light
- Solarized
- Ocean
- Terminal

Classic is the current workspace composition.

## Known development caveat

Repository-wide GitHub Actions currently encounter an older root integrity assertion that expects the root manifest name to be `AI Bridge`, while the promoted root manifest is currently `AI Bridge Human Test`.

That failure occurs before some AI_OUTPUT tests run and is not by itself evidence that the human-test recovery runtime failed.

Targeted recovery regressions live under:

```text
AI_OUTPUT/tests/
```

## Bug-report checklist

For a useful report, include:

- build string: **1.19.1.08-AI-A**;
- active work mode;
- active AI count;
- affected AI side/provider;
- exact Dashboard error/status;
- whether the provider received the prompt zero/one/multiple times;
- whether the extension or provider tab had just been refreshed;
- screenshot or console error if available.

For recovery bugs, **do not clear extension storage first**. Persisted state is often the evidence needed to reproduce the problem.

## Promotion workflow

`AI_INPUT` is for human testing.

AI-generated development work is staged under `AI_OUTPUT/` first. After review and successful human testing, approved changes can be promoted to the repository root.
