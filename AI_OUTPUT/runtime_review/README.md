# AI Bridge runtime_review

This directory is a complete unpacked Manifest V3 review build staged under AI_OUTPUT.

Security/runtime differences from root v1.18:
- Chrome event listeners register synchronously before async recovery.
- The exact reviewed DispatchLedger, IncomingResponseGate, ParkedResponseStore, RolloverCoordinator, and canonical six-field authority logic are bundled into runtime-core.js and loaded synchronously by the classic worker.
- Every outbound provider dispatch is persisted before provider delivery.
- Worker restart converts unresolved DISPATCHING/ACCEPTED delivery into DELIVERY_AMBIGUOUS and pauses instead of generating a replacement dispatch.
- Provider actions require document registration and documentId-targeted commands.
- Inbound responses carry dispatchId, generationEpoch, and six-field conversation identity and must pass the response gate before transcript/turn mutation.
- Response envelopes are durably parked/claimed; response state is saved with relay suppressed, then RESPONSE_COMMITTED and a durable NEXT_TURN_PENDING obligation are persisted before the parked response is finalized.
- The exact next sequential payload (or batch phase-advance obligation) survives MV3 worker death. When future work is owed, NEXT_TURN_PENDING is persisted before the source dispatch may become RESPONSE_COMMITTED.
- If continuation persistence fails, the source remains uncommitted; if the source commit fails after the marker is durable, recovery pauses with the marker preserved.
- Startup detects impossible committed-response-without-continuation states and pauses with RUNTIME_CONTINUATION_STATE_INCONSISTENT instead of guessing.
- Dashboard exposes runtime progression separately from provider health: Dispatching, Awaiting response, Next turn pending, Recovering next turn, Paused.
- Broad-text New Chat automation is disabled.
- Synthetic Enter fallback is disabled.
- Raw Upload is LIMITED until trusted upload authority exists.
- Dashboard and Settings expose Connection / Authority / operation-specific readiness.
- ChatGPT hard conversation-length UI can pause the bridge, but automatic New Chat remains LIMITED until trusted provider authority is available.

This artifact is for human and real-Chrome E2E review before any root integration.


## Real Chrome MV3 fault gate

Run:

```bash
node AI_OUTPUT/tests/chrome-e2e-runtime.cjs
```

Requirements:
- Node.js 22+
- a current Chrome/Chromium binary (or CHROME_BIN)
- Chrome must permit unpacked extension installation through the DevTools Extensions domain.

The harness uses `--remote-debugging-pipe` plus `--enable-unsafe-extension-debugging`, installs this exact runtime_review directory with `Extensions.loadUnpacked`, serves controlled ChatGPT fixtures through CDP Fetch interception, starts a real bridge session, kills the MV3 service worker after the provider action but before ACK confirmation, wakes the worker, and verifies:
- the original dispatch becomes DELIVERY_AMBIGUOUS;
- the session visibly pauses;
- Resume cannot create a replacement provider action;
- the provider action count remains exactly one;
- New Chat and fresh-chat startup remain visibly LIMITED.

A browser policy that forbids unpacked extension installation is a test failure, not a pass or silent skip.


### Paused-session provider re-verification

Provider health checks for already-bound tabs may re-establish document authority even while the relay session is paused. This registration handshake has no provider-side action and does not clear the session pause.

The real-Chrome gate requires both truths after ambiguous-delivery recovery:
- provider: Connected / Verified / Relay READY;
- session: Paused because prior delivery is ambiguous.

The harness also counts response transcript commits and requires zero for the provider-click-before-ACK kill case and after the refused Resume.


### Recovery snapshot matrix

The Chrome E2E harness now seeds durable crash snapshots through the DevTools Extensions storage API and validates both backend state and rendered Dashboard state.

Covered snapshots:
- committed response with no continuation: explicit inconsistency pause;
- durable continuation with uncommitted source: explicit fail-closed pause;
- committed response with valid continuation: deterministic recovery, exactly one target provider action, one target dispatch in AWAITING_RESPONSE, continuation marker cleared.

The positive fixture separates SEND confirmation from assistant-response emission so recovery can reach a stable AWAITING_PROVIDER_RESPONSE state without triggering another relay turn.


### Dashboard lifecycle across seeded recovery cases

The DISPATCHING/ACCEPTED matrix now tracks the currently-live Dashboard target explicitly instead of repeatedly closing the earlier CREATED-case page. Each scenario owns the page produced by the previous scenario, preventing stale-target failures from skipping the ACCEPTED case.

The CREATED reuse scenario also asserts the rendered success state:
- session Running;
- Runtime: Awaiting provider response;
- not Runtime: Paused;
- same durable target dispatch ID reused.


### Fault-scenario page isolation and Dashboard helper

Popup and Settings are closed immediately after their smoke checks so periodic UI polling cannot wake the MV3 worker between stopAllWorkers() and seeded storage injection.

Paused-state recovery assertions now inspect the actual #sessionPill and #status elements instead of broad document.body text. The helper is exported behind a require.main guard and is directly executed by round34-paused-dashboard-helper.cjs, including a negative Running-state case.


### CREATED-snapshot dispatch isolation

The target-CREATED recovery scenario uses a fresh synthetic dispatch ID that has never reached the surviving provider-B content document. It preserves the runtime-generated tab, provider identity, generation, conversation identity, and payload hash, but does not reuse an ID already stored in content.js duplicate authority memory.

The harness asserts the CREATED ID differs from the previously delivered positive-recovery dispatch and is absent from all earlier matrix dispatch IDs before waking the worker. This prevents content-side byAuthority duplicate caching from suppressing the intended CREATED delivery.


### Lost-ACK element-specific UI contract

The canonical provider-click/lost-ACK recovery case now uses the same element-specific standard as the seeded matrix:
- #sessionPill and #status are validated through assertPausedDashboard();
- #healthA must show Connected / Verified / Relay READY / Rollover LIMITED / Artifacts LIMITED;
- #newChatA and #freshOnStart must remain disabled.

The harness no longer accepts whole-page document.body text as evidence for this recovery state. Helper-return objects are treated by shape: paused helpers return {pill,status}; deterministic helpers are read through their .status field.


### Seeded dispatch lifecycle validity

Seeded recovery snapshots now satisfy the same DispatchLedger lifecycle invariants as runtime-created records:
- AWAITING_RESPONSE has acceptedAt and no completedAt;
- RESPONSE_COMMITTED has acceptedAt and completedAt;
- CREATED has neither acceptedAt nor completedAt;
- ACCEPTED has acceptedAt and no completedAt.

This prevents the worker from rejecting synthetic crash snapshots during ledger restore before the intended recovery behavior is exercised.


### Provider operational events

AI Bridge classifies trusted provider UI failures such as "Message delivery timed out. Please try again." before normal response commit. Operational events are bound to the existing dispatch, deduplicated, recorded as provider_event transcript entries, and pause the session in PROVIDER_RECOVERY_REQUIRED without allocating or replaying a normal SEND.

The original dispatch remains response-capable. If the provider/human retries in the provider UI and a valid response later appears, AI Bridge correlates it to the same dispatch. Provider-event transcript entries are displayed for diagnostics but excluded from AI-to-AI prompt context.


Current provider-event codes are:

- `MESSAGE_DELIVERY_TIMEOUT`
- `CONNECTION_INTERRUPTED`
- `NETWORK_ERROR`
- `GENERATION_ERROR`
- `RATE_LIMIT`
- `USAGE_LIMIT`
- `AUTH_REQUIRED`
- `CONTENT_BLOCKED`

### Provider-event authority

Provider operational events are control-plane inputs. Before a provider event may pause or otherwise change a session, the background verifies the currently registered top-level active document, Chrome documentId, authority-registration token, tab/side/provider, generation epoch, and the full six-field conversation identity against both the live document authority and the dispatch ledger. Stale or mismatched events are rejected and cannot mutate relay state.

Operational-event DOM probes are restricted to visible alert/ARIA-live system surfaces outside assistant-message DOM. Assistant responses are never scanned for provider-error phrases, preventing a model that quotes an error message from falsely triggering recovery.
