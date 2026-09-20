# AI Bridge

AI Bridge is a Chrome Manifest V3 extension for coordinating multiple browser-based AI conversations as one working team.

Instead of manually copying replies between tabs, AI Bridge assigns each browser tab to an AI role, gives every role a job and shared objective, relays completed responses, tracks the shared transcript, and keeps a human controller in the loop when an AI needs a decision.

The project is under active development. The repository intentionally separates promoted code, human-test builds, and AI-produced review work.

## Current repository state

| Area | Purpose | Current state |
| --- | --- | --- |
| Repository root | Promoted baseline | `1.19.1.04-AI-A` |
| `AI_INPUT/` | Human-test build loaded unpacked in Chrome | `1.19.1.08-AI-A` |
| `AI_OUTPUT/` | AI development/review area before promotion | Active |
| `AI_OUTPUT/runtime_review/` | Reviewed runtime candidate | Active |
| `AI_OUTPUT/tests/` | Security/regression tests for review work | Active |

For current testing, load **`AI_INPUT/`**, not the repository root.

## What AI Bridge does

AI Bridge currently supports **1–5 active AI roles** (`AI A` through `AI E`). Each role is bound to its own browser tab.

The same provider may occupy multiple roles as long as each role uses a different tab. This makes it possible to run multiple independent conversations from the same model/provider and treat them as separate agents.

Each active AI can receive:

- its assigned job;
- the full active team roster;
- standing team rules;
- the human controller's primary objective;
- the selected work-mode instructions;
- recent shared transcript/context;
- source material selected in the Dashboard;
- human replies and queued interjections when applicable.

AI Bridge then captures completed responses and advances the team according to the selected work mode.

## Work modes

AI Bridge currently exposes six work modes.

### Relay

Normal sequential relay.

Example:

```text
AI A → AI B → AI C → AI A → ...
```

Each AI receives the accumulated team context and the next active role speaks after the previous role completes.

### Collaborate

Sequential shared-deliverable mode.

Each AI works on the same result using its assigned specialty and is expected to improve or challenge the work already produced by the team.

### Compete

All active AIs receive the same objective simultaneously and submit independent answers.

### Parallel Independent

All active AIs work simultaneously and independently on the objective. This is useful when separate implementations, approaches, or research passes are wanted.

### Peer Review

Two-phase mode:

1. every active AI produces an independent primary answer;
2. every active AI receives the other primary answers and performs a review/critique pass.

### Direct Mesh

Sequential relay with explicit AI-to-AI routing.

An AI may route its completed response directly to another active teammate by placing a final routing line such as:

```text
SEND TO: AI C
```

If no valid final routing command is present, normal next-agent routing is used.

## Human control

The human controller remains part of the team instead of being treated as an external observer.

### Human-input requests

AIs are instructed to request human input when a decision or missing fact is genuinely required.

The preferred protocol is:

```text
[[HUMAN_INPUT: your specific question to the human]]
```

AI Bridge pauses the relay, raises the Dashboard human-input UI, and sends the human's answer back to the requesting AI before continuing.

Human requests can also be suppressed or reopened.

### Human interjection

The Dashboard can queue a human interjection for the configured Main AI. It is delivered on that AI's next turn without pretending the text came from another AI.

## Agent configuration

The Dashboard currently supports:

- 1–5 active agents;
- independent labels for each AI slot;
- independent job descriptions;
- a configurable starting AI;
- a configurable Main AI;
- standing team rules;
- finite turn limits from 1–10000;
- `-1` for unlimited AI turns;
- configurable delay between sequential turns;
- per-AI round timing/history.

Changing the number of active agents changes the live route rather than requiring a separate three-agent/five-agent build.

## Provider surfaces

The extension recognizes browser tabs for:

- ChatGPT;
- Grok;
- Gemini;
- Claude;
- Microsoft Copilot.

Provider recognition does **not** mean every provider currently has identical trusted-action coverage.

AI Bridge intentionally uses provider-specific trusted DOM selectors and document/conversation identity checks. The Dashboard provider-health path reports whether a selected tab is connected and whether trusted relay authority is currently READY, WAITING, BLOCKED, or LIMITED.

Current trusted send coverage is strongest on the providers whose composer/send DOM has been explicitly verified. Unsupported or ambiguous provider controls fail closed instead of using broad `button` or text-click automation.

## Same-model multi-agent operation

AI Bridge does not require every role to use a different LLM.

For example:

```text
AI A → ChatGPT tab 1
AI B → ChatGPT tab 2
AI C → Grok tab 1
AI D → ChatGPT tab 3
```

Each role has its own conversation/document authority and its own relay state. This allows one model family to contribute multiple independent viewpoints or carry more weight in a team.

## Sources, history, and Vault

The Dashboard supports local source material and persistent working context.

Current source handling includes:

- drag/drop or file selection;
- ignored development folders such as `.git`, `node_modules`, virtual environments, build output, and caches;
- bounded source-file and total-context sizes;
- delivery tracking so source context is not repeatedly resent unnecessarily.

AI Bridge also keeps job/command history and includes a persistent artifact/Vault subsystem.

Provider-side artifact extraction and trusted upload authority are still **LIMITED** and should not be treated as fully implemented across providers.

## Themes and workspace

The current workspace is **Classic**.

Available color themes are:

- Blizzard
- Ghostwhite
- Midnight
- Slate
- Light
- Solarized
- Ocean
- Terminal

Older Studio/Focus workspace preferences are migrated to Classic. Color themes remain independent of workspace layout.

## Durable relay and exactly-once safety

AI Bridge is designed around the fact that Chrome Manifest V3 service workers are temporary and may restart between events.

The review/human-test runtime therefore maintains durable relay state rather than assuming the background worker remains alive.

Important mechanisms include:

- per-dispatch IDs;
- provider tab/document authority;
- generation epochs;
- conversation identity;
- durable dispatch lifecycle records;
- durable `nextTurnPending` continuation records;
- continuation-source provenance;
- parked response commit barriers;
- transaction-scoped dispatch recovery;
- content-side action proof for restart recovery;
- cross-session durability reset;
- fail-closed handling of ambiguous delivery.

A dispatch progresses through controlled lifecycle states such as:

```text
CREATED
→ DISPATCHING
→ ACCEPTED
→ AWAITING_RESPONSE
→ RESPONSE_COMMITTED
```

If AI Bridge cannot prove whether a provider action occurred, it does **not** blindly resend the prompt. Duplicate AI submissions can be more damaging than a safe pause.

The current `AI_INPUT` build also repairs several restart/recovery cases that previously produced:

```text
UNRESOLVED_DISPATCH_BLOCKS_REPLAY
```

Recovery now distinguishes the current continuation transaction from unrelated stale dispatches and can safely retire orphaned `CREATED` records because `CREATED` proves that no provider action was attempted.

## Provider operational errors

Provider UI errors are treated as control-plane events instead of AI responses.

Examples include:

- delivery timeout;
- connection interruption;
- network error;
- generation error;
- rate/usage limits;
- authentication requirements;
- provider policy/content blocks.

When delivery is ambiguous, AI Bridge preserves the original dispatch relationship and pauses rather than silently generating a second submission.

## Conversation max-length detection and rollover

Automatic thread rollover is an active development area.

### Implemented

The current content runtime can detect the authoritative ChatGPT conversation-length warning:

```text
You've reached the maximum length for this conversation...
```

It deliberately excludes ordinary usage limits, rate limits, upload limits, and generic network/provider errors.

### Still limited

A fully trusted automatic New Chat authority is **not yet enabled** in the current human-test runtime.

When the authoritative ChatGPT thread limit is detected, AI Bridge currently pauses rather than performing an untrusted navigation/click.

The intended rollover flow is:

```text
LIMIT_DETECTED
→ FINAL_RESPONSE_COMMITTED
→ CONTINUITY_PREPARED
→ OLD_AUTHORITY_REVOKED
→ NEW_SURFACE_OPENING
→ NEW_CONVERSATION_CONFIRMED
→ CONTINUITY_SENT
→ COMPLETE
```

The rollover implementation must preserve the completed response, conversation continuity, exactly-once delivery, and title/continuation context without depending on fragile broad DOM actions.

Grok hard-limit rollover remains fail-closed until a trustworthy provider-specific limit signature is verified.

## Security model

Security is a primary design constraint.

AI Bridge avoids treating arbitrary page DOM as trusted authority. Important rules in the current design include:

- provider-specific selector allowlists;
- visible/unique control resolution;
- document registration challenges;
- exact tab/document/generation matching;
- conversation identity matching;
- no automatic replay after ambiguous provider delivery;
- no broad generic New Chat click when authority is unproven;
- bounded in-memory duplicate-command caches;
- durable exactly-once records across worker restarts;
- extension-page Content Security Policy;
- bounded source/artifact storage.

This does not make browser DOM automation impossible to break. Provider DOM changes are expected, so provider actions are designed to fail closed when authority cannot be proven.

## Loading the current human-test build

The current human-test build is:

```text
1.19.1.08-AI-A
```

To load it:

1. Pull the latest repository state.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the repository's **`AI_INPUT`** directory.
6. Confirm the extension reports `1.19.1.08-AI-A`.
7. Open the provider conversations you want to use.
8. Refresh provider tabs after reloading/updating the extension so the active content script matches the current build.
9. Open the AI Bridge Dashboard and bind each active AI role to a provider tab.

Do not use the repository root when validating fixes that exist only in `AI_INPUT` or `AI_OUTPUT`.

## Repository workflow

Development intentionally follows a staged flow.

### `AI_OUTPUT/`

AI-generated work lands here first for review.

Important subareas currently include:

- `runtime_review/` — reviewed candidate runtime;
- `thread_rollover/` — rollover, authority, ledger, and continuity components;
- `dom_resilience/` — provider DOM-health/resilience work;
- `startup_guard/` — startup/recovery guards;
- `integration/` — integration work;
- `tests/` — regression/security tests.

### `AI_INPUT/`

Human-test package.

This folder is the build that should normally be loaded unpacked while a candidate is being exercised in Chrome.

### Repository root

Promoted baseline.

Changes are expected to survive AI review and human testing before being promoted here.

## Testing

The project contains targeted Node-based regression tests under `AI_OUTPUT/tests/`.

The security runner is:

```bash
node AI_OUTPUT/tests/security-regression-runner.mjs
```

Individual regression files can also be run directly with Node when isolating a specific feature.

At the moment, repository-wide GitHub Actions also contain a known unrelated root integrity mismatch: the root manifest is named `AI Bridge Human Test` while an older integrity assertion still expects `AI Bridge`. That assertion can fail before AI_OUTPUT tests execute, so a red workflow does not automatically identify the review-runtime failure. Inspect the failing job/test rather than treating every red run as the same defect.

## Current priorities

The active development priorities are:

1. finish safe automatic conversation max-length rollover;
2. continue hardening MV3 restart/recovery and exactly-once relay behavior;
3. improve DOM resilience as provider UIs change;
4. keep AI_INPUT coherent with reviewed runtime fixes;
5. reduce excessive UI corner rounding while preserving the Classic layout;
6. continue restoring/preserving themes and settings while runtime work proceeds.

## Bug reports

Useful bug reports include:

- loaded build string;
- work mode;
- active AI count;
- affected AI side/provider;
- exact Dashboard status/error;
- whether the provider received the prompt zero, one, or multiple times;
- whether the wrong text was relayed;
- whether the browser/extension/service worker had just been refreshed or restarted;
- screenshots or console errors when available.

For recovery bugs, do **not** delete extension storage unless that is specifically the thing being tested. The persisted state is often the most valuable evidence.

## Project philosophy

AI Bridge is built around a simple idea: multiple browser AI conversations should be able to operate as a coordinated software/research/design team without requiring the human to become the message bus.

The human remains the controller. The extension handles routing, continuity, state, and safety boundaries.
