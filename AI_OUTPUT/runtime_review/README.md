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
