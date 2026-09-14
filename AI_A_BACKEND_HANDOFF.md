# AI A backend handoff — dashboard + turn-limit work

Repository: https://github.com/drkevorkian/AI_Bridge
Review branch: https://github.com/drkevorkian/AI_Bridge/tree/ai-a/dashboard-turns-backend

## Important Chrome URL correction

An extension cannot own a `chrome://...` URL. Chrome reserves that scheme for browser internals. The extension-owned full-page UI must be packaged as (for example) `dashboard.html` and opened with:

```js
chrome.runtime.getURL("dashboard.html")
```

The resulting runtime URL is `chrome-extension://<extension-id>/dashboard.html`. Do not hard-code the extension ID; unpacked IDs can vary.

## Current backend facts

- `background.js` currently defaults `maxTurns` to `30`.
- `AI_BRIDGE_START` currently clamps turns to `1..300` with:

```js
fresh.maxTurns = Math.max(1, Math.min(300, Number(msg.maxTurns) || 30));
```

- `handleCompletedResponse()` currently ends when:

```js
if (state.turn >= state.maxTurns) {
  await endBridge(`Reached maximum of ${state.maxTurns} AI turns`);
  return { ok: true, finished: true };
}
```

- AI output is already persisted in `state.transcript`. Each completed model response is a `response` entry with `seq`, `time`, `side`, `label`, and `text`. Human replies are `human` entries. The dashboard should render these; it does not need to scrape the AI tabs itself.

## Required turn semantics

Human requirement:

- `-1` = infinite / no automatic turn cap.
- finite range = `1..10000` turns.
- `0` should not be treated as infinite because it creates ambiguous behavior after the first AI response. Reject it or normalize it to 1; I recommend strict rejection.
- Make the default `-1` unless the team decides the existing 30-turn default must be preserved for safety.

Recommended helper:

```js
const MIN_FINITE_TURNS = 1;
const MAX_FINITE_TURNS = 10000;
const INFINITE_TURNS = -1;

function normalizeMaxTurns(raw) {
  if (raw === undefined || raw === null || raw === "") return INFINITE_TURNS;

  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error("Max AI turns must be -1 (infinite) or an integer from 1 to 10000.");
  }
  if (value === INFINITE_TURNS) return INFINITE_TURNS;
  if (value < MIN_FINITE_TURNS || value > MAX_FINITE_TURNS) {
    throw new Error("Max AI turns must be -1 (infinite) or an integer from 1 to 10000.");
  }
  return value;
}

function hasReachedTurnLimit() {
  return state.maxTurns !== INFINITE_TURNS && state.turn >= state.maxTurns;
}
```

Then in `DEFAULT_STATE`:

```js
maxTurns: INFINITE_TURNS,
```

In `AI_BRIDGE_START`:

```js
fresh.maxTurns = normalizeMaxTurns(msg.maxTurns);
```

In `handleCompletedResponse()`:

```js
if (hasReachedTurnLimit()) {
  await endBridge(`Reached maximum of ${state.maxTurns} AI turns`);
  return { ok: true, finished: true };
}
```

Do **not** use `state.turn >= state.maxTurns` with `-1`; that would terminate immediately after the first response.

## Dashboard backend/data contract

The least-risk implementation is a packaged `dashboard.html` that uses the same runtime messages as the popup:

- `AI_BRIDGE_GET_STATE`
- `AI_BRIDGE_START`
- `AI_BRIDGE_PAUSE`
- `AI_BRIDGE_RESUME`
- `AI_BRIDGE_STOP`
- `AI_BRIDGE_RESEND`
- `AI_BRIDGE_HUMAN_REPLY`

For output rendering, read `state.transcript` and render `response` and `human` entries. Use `seq` as the stable DOM key, and render model text via `textContent`, never `innerHTML`.

Recommended optional backend command so popup/action code can open a single dashboard tab:

```js
async function openDashboard() {
  const url = chrome.runtime.getURL("dashboard.html");
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find(tab => tab.url === url);

  if (existing?.id) {
    if (existing.windowId) await chrome.windows.update(existing.windowId, { focused: true });
    await chrome.tabs.update(existing.id, { active: true });
    return existing.id;
  }

  const tab = await chrome.tabs.create({ url });
  return tab.id;
}
```

A popup button can also call `chrome.tabs.create({url: chrome.runtime.getURL("dashboard.html")})` directly if single-instance behavior is not required.

## Scaling warning introduced by true infinite mode

`state.transcript` and `state.log` currently grow without bound and the whole state is persisted with every `saveState()`. A truly unlimited relay can eventually make `chrome.storage.local` and full-state polling expensive. This is not a reason to reintroduce a turn cap, but it is a backend concern to address.

Recommended minimum for this release:

1. Add `"unlimitedStorage"` permission if retaining the complete transcript indefinitely is a requirement.
2. Dashboard should avoid rebuilding the entire transcript every 750 ms. Keep the last rendered `seq` and append only newer entries from the returned state.
3. Follow-up architecture: move full transcript history to IndexedDB or chunked storage, keep only a recent relay-context window plus cursors in `bridgeState`, and expose paged transcript reads to the dashboard.

## UI requirements for Grok/Gemini

- New full-page dashboard contains the existing main controls plus an AI-output/transcript area.
- Max-turn input uses `min="-1"`, `max="10000"`, `step="1"`; helper text says `-1 = infinite`.
- Status must display `∞` / `Infinite` when `maxTurns === -1`, not `turn/-1`.
- Provide an obvious way from the existing popup to open the dashboard, or make the toolbar action open the dashboard if the popup is intentionally retired.
- The extension page URL must be generated with `chrome.runtime.getURL`; do not claim a stable hard-coded extension ID.

## Verification matrix

- Start with `-1`: after responses A→B→C→A, session remains active and never stops due to turn count.
- Start with `1`: stop after the first completed AI response.
- Start with `10000`: accepted unchanged.
- `0`, `-2`, `10001`, `1.5`, nonnumeric: rejected with a clear error.
- Pause/resume preserves `-1` exactly.
- Existing saved sessions with finite values such as 30 continue to work.
- Dashboard renders stored AI responses after reopening/reloading the extension page.
- Transcript rendering is text-only/safe from model-produced HTML/script strings.
