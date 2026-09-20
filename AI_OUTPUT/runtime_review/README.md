# AI Bridge runtime_review

This directory is a complete unpacked Manifest V3 review build staged under AI_OUTPUT.

Security differences from root v1.18:
- Chrome listeners register synchronously before async state recovery.
- Provider actions require a document registration handshake and documentId-targeted command.
- SEND is single-attempt; ambiguous results are not replayed.
- Broad-text New Chat automation is disabled.
- Synthetic Enter fallback is disabled.
- Raw Upload is LIMITED until trusted upload authority exists.
- ChatGPT hard conversation-length UI is detected; the bridge pauses because trusted automatic New Chat authority is still unavailable.

This artifact is for human and Chrome E2E review before any root integration.
