# DOM resilience (AI C — review only)

Review-only modules. Do not copy into extension root until human acceptance.

## Why this exists

Main `content.js` adapters treat the first visible match of a broad selector as authority. Grok currently authorizes `textarea`, `div[contenteditable='true']`, `article`, and `div[class*='message']`. That survives a provider redesign by matching the *wrong* node.

Main also constructs a `MutationObserver` with an empty callback and still polls every 650ms. This package replaces that with scored contracts + dirty-probe observation.

## Modules

- `selector-ranking.js` — rank, uniqueness, and health scoring. No DOM writes.
- `provider-dom-contracts.js` — packaged per-provider probe lists and limit-region (not response-body) signatures.
- `dom-health-monitor.js` — bounded observer, dirty-set debounce, `isConnected` invalidation, route-change revalidation.
- `conversation-identity.js` — URL → surface vs conversation, transition classifier, content-side dispatch idempotency cache. Background still owns dispatchId generation.

## Security

- Contracts are packaged constants. Never read selectors from the page, storage written by the page, or remote URLs.
- No `innerHTML`, `eval`, `new Function`, or click-all fallback.
- Limit signatures are accepted only from banner / composer / system regions. Text inside `assistant_response` is untrusted and cannot authorize rollover.
- No raw DOM nodes leave the content script. Background receives `{ state, selectorId, matchCount, reason, nodeConnected }` only.

## Grok policy (locked with A)

Automatic rollover requires a high-confidence limit-region signature. Grok ships with an empty/sparse authority list in v1 of this package. Uncertain degradation → pause. Manual `AI_BRIDGE_NEW_CHAT` remains available.
