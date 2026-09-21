# Thread rollover review modules

This directory is review-only and is not wired into the extension root.

## Purpose

- Detect authoritative hard conversation-length limits without confusing quota, transport, upload, or model-written text for a thread limit.
- Represent automatic conversation rollover as a durable, restart-safe state machine.
- Fail closed on unchanged identities, read-only/share routes, provider mismatches, stale old-thread responses, and ambiguous delivery.

## Security invariants

1. Normal assistant response text never authorizes rollover.
2. Grok has no trusted automatic hard-limit signature in this batch; uncertain Grok exhaustion pauses for manual recovery.
3. The exhausted thread's final assistant response must be durably committed before old conversation authority is revoked.
4. The continuity payload, including the final committed assistant response and Roman-numeral continuation title, must be durably prepared before revocation/navigation.
5. Old conversation authority must be revoked before opening the replacement chat.
6. The continuity response must match the continuity dispatch ID and a new authorized conversation identity.
7. Provisional surface identities are not final authority unless an explicit packaged provider policy allows stable-surface conversations.
8. Ambiguous provider delivery pauses instead of blindly replaying continuity.

Integration into `background.js` / `content.js` is intentionally deferred until human review and later debug rounds.
