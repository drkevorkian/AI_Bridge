# AI A handoff — v1.9 Human Control + Gemini Capture

Base: AI Bridge v1.8 Work Mode candidate.

## Human controller requests addressed

1. Gemini transcript sometimes captured only `Gemini said` / partial response.
2. Human-interaction detection needs to be more sensitive.
3. Human needs to interject steering notes during a live team session.
4. Human-input attention needs a centered modal popup.

## Gemini capture fix

`content.js` now:
- anchors Gemini on the latest top-level `model-response` / `.model-response` / `[data-test-id='model-response']`;
- searches known nested answer containers and chooses the richest content block;
- strips provider accessibility headings and rejects label-only stubs such as `Gemini said`;
- checks stop/streaming/busy indicators;
- requires 4.2 seconds of stable Gemini text before committing, vs 2.2 seconds on other providers;
- reports content-script version 1.9.0 so already-open v1.8 AI tabs are refreshed/reinjected by the existing listener-version guard.

## Human-input sensitivity

The prompt protocol now tells agents to ask when a material ambiguity, preference, approval, clarification, permission, or scope decision could send work down the wrong path or waste substantial effort.

`extractHumanRequest()` now:
- scans the last 10 non-empty lines instead of only the exact final line;
- tolerates Markdown decoration / formatting drift around the marker;
- accepts explicit HUMAN INPUT / DECISION / APPROVAL / CLARIFICATION / PERMISSION forms;
- detects clear natural-language blockers such as `I need your decision...`, `I need you to choose...`, `cannot continue without...`, `please choose/confirm...`;
- intentionally does NOT trigger on generic optional offers such as `Would you like me to make a chart?`.

## Human modal

The old small sidebar human-response panel is replaced with a fixed, centered, modal dialog. It shows:
- HUMAN INTERACTION NEEDED banner;
- requesting AI label;
- exact question/request;
- response textarea;
- queued human-request count;
- Send response & continue.

`showHumanAttention()` now also focuses/opens the AI Bridge dashboard in addition to the existing extension badge + browser notification.

## Human interjection

The dashboard now has:
- a persistent Human interjection composer in the control panel;
- an Interject shortcut in the transcript header that scrolls/focuses the composer.

`AI_BRIDGE_INTERJECT` records a HUMAN CONTROLLER transcript entry with `interjection: true` and does not consume an AI turn. It is deliberately not typed into a provider while that AI is mid-generation. Normal Relay/Collaborate handoffs pick it up through unseen transcript context; Peer Review primary-phase interjections are also explicitly included in review prompts.

Current limitation by design: a one-pass Compete/Parallel phase has no later safe handoff after all three submissions finish, so an interjection made very late in such a phase may remain transcript context only. Do not solve that by typing into an actively-generating provider; if we want immediate batch steering later, add an explicit extra steering phase with turn-budget semantics.

## Tests passed

- `node --check` on background/content/dashboard/popup
- manifest JSON parse, version 1.9.0
- duplicate HTML ID checks
- 40/60 layout retained
- full v1.8 work-mode regression suite
- explicit marker human-input test
- Markdown-decorated marker test
- natural-language blocker test
- generic optional-offer negative test
- interjection recorded without incrementing AI turn
- Gemini extractor unit test: richest body wins and `Gemini said` stub is rejected
- ZIP integrity

Candidate ZIP SHA-256: `10c2c88c8d02a45c1877fbc95a4cbd44426ce71a43566d88cebd8e89cc322416`
Full source snapshot SHA-256: `a5b892ec66fbca6893c2e31d74d8f242cb0278dc26206ccc9fab4122d4cca18b`

## AI B review focus

1. Live-test Gemini with a long multi-paragraph answer and verify the transcript receives the full body, not `Gemini said`.
2. Test Gemini pauses/tool-use/grounding so the 4.2s stability window does not commit early.
3. Test natural-language human blocking and exact-marker blocking on all three providers.
4. Verify modal focus/queue behavior with two AIs requesting human input during a batch mode.
5. Verify a human interjection appears in the next Relay/Collaborate handoff and in Review phase prompts.
6. Preserve the safe-handoff rule: do not inject a human note into a provider that is actively generating.

## AI C review focus

Review modal visibility/contrast in all six themes, control-panel interjection density, and the workspace-header Interject shortcut. The modal intentionally has no dismiss/X because the bridge is blocked until the controller answers.
