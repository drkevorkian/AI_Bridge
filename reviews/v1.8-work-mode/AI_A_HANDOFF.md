# AI A handoff — v1.8 Work Mode

Base: AI Bridge v1.7 fresh-chat candidate with v1.6 artifact relay integrated.

## New work strategies

- `relay`: original A → B → C sequential relay.
- `collaborate`: sequential shared-deliverable mode; every agent is told to improve one common result.
- `compete`: A/B/C receive the same objective concurrently and submit independently. No primary peer output is shown during the pass.
- `parallel`: A/B/C receive the same objective concurrently and work independently without competitive framing.
- `review`: phase 1 runs A/B/C independently; phase 2 sends each AI the *other two latest primary responses* and collects three critiques.

## State/scheduler additions

Persisted state remains `STATE_VERSION = 3` for v1.7 saved-session compatibility. New defaulted fields:
`workMode`, `workPhase`, `phasePendingSides`, `phaseSentSides`, `phaseCompletedSides`, `primaryResponseSeqBySide`, `reviewResponseSeqBySide`, `pendingHumanQueue`.

Simultaneous responses are serialized through `responseCommitQueue`. The AIs still generate concurrently; only background bookkeeping/storage commits are serialized so overlapping completions cannot overwrite phase state.

Batch phase sends use `Promise.allSettled`. Successfully dispatched sides are tracked separately from pending/completed sides so Resume can retry only unsent prompts after a partial send failure.

If a pending worker is rebound to a different tab (or its tab is closed), that side is removed from `phaseSentSides`. Resume therefore re-sends the current phase prompt to the replacement chat instead of waiting forever on work that was sent only to the old tab.

## Turn semantics

Turns still mean completed LLM responses only.
- Relay/Collaborate: minimum finite setting 1.
- Compete/Parallel: minimum finite setting 3.
- Review: minimum finite setting 6.
- `-1` remains accepted for every mode.

Compete/Parallel finish after one 3-response pass even with `-1`. Review finishes after primary + critique (6 normal responses) even with `-1`.

## Human input in simultaneous modes

A human-input request pauses phase advancement but does **not** discard other agents that finish while the controller is answering. Their responses are still committed. Additional simultaneous human requests are queued. Answering a requesting AI reopens that side in the current phase and sends the normal human-reply continuation.

## Review isolation

Peer-review prompts contain only the other two AIs' latest primary responses, not the reviewer's own primary response. Peer artifacts are included through the existing Shared Vault handoff.

## UI

Adds a Work strategy dropdown + mode-specific help. `First speaker` is disabled for Compete/Parallel/Review because all three start together. Transcript cards show `PRIMARY` or `REVIEW` phase tags. Running status lists all pending AIs for batch modes. Resend is disabled for a side that already completed the current simultaneous phase.

## Tests run by AI A

- `node --check` background/content/dashboard/popup
- manifest parse/version 1.8.0
- no duplicate HTML IDs
- 40/60 layout retained
- Relay A→B regression
- Collaborate prompt regression
- Compete pass: arbitrary completion order, exactly 3 responses
- Parallel pass: arbitrary completion order, exactly 3 responses
- Review cycle: 3 primary + 3 critiques, exactly 6 responses
- each reviewer receives only the other two primary responses
- other simultaneous responses are retained while one AI awaits human input
- response commit serialization present
- replacement-tab bookkeeping marks pending batch work unsent for Resume

Candidate ZIP SHA-256: `67c646dc85f8029749e9d92cb3e44ad2f0c37d52bb9812eb47182940d2ef9501`

## AI B review focus

1. Stress-test three near-simultaneous completions in the real extension.
2. Test partial batch-send failure + Resume.
3. Test replacing one pending AI tab and confirm Resume re-sends only that missing worker's phase prompt.
4. Test one AI asking for human input while the other two finish.
5. Verify Review sends A only B/C, B only A/C, C only A/B.
6. Preserve `responseCommitQueue`; do not revert to independent state saves per simultaneous response.

## AI C review focus

Review dropdown wording/density in the 40% left panel, phase status readability, and PRIMARY/REVIEW transcript tags. No frontend coding required unless requested by AI B.
