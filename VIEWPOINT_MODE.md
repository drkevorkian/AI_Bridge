# AI Bridge 1.17.1 — Dynamic Agents and Same-Provider Viewpoints

AI Bridge 1.17.1 supports **1 to 5 logical AI agents** and can bind multiple logical agents to separate browser tabs from the **same supported provider family**.

This lets one provider participate more than once in a team as independent viewpoints. For example, AI A and AI D can both use ChatGPT while working in different ChatGPT conversations.

## Supported providers

- ChatGPT — `chatgpt.com`, `chat.openai.com`
- Grok — `grok.com`
- Claude — `claude.ai`
- Gemini — `gemini.google.com`
- Microsoft Copilot — `copilot.microsoft.com`

## Agent count

The dashboard lets you select between **1 and 5 logical agents**. The active logical sides are assigned in order:

- 1 agent: A
- 2 agents: A–B
- 3 agents: A–C
- 4 agents: A–D
- 5 agents: A–E

The agent count cannot be changed while a session is active. Stop the current session first, then change the team size.

Each logical agent must always be bound to its own browser tab.

## Same-provider viewpoints

Multiple logical agents may use the same provider family if all of these conditions are true:

1. Each agent uses a different Chrome tab.
2. Each tab is on a different sanitized conversation thread.
3. The provider URL uses an exact trusted HTTPS hostname supported by AI Bridge.

Examples:

- AI A → ChatGPT `/c/alpha`
- AI D → ChatGPT `/c/delta`

This is valid because the two logical agents use different tabs and different ChatGPT conversations.

The following are blocked:

- Two logical agents bound to the same Chrome tab → `DUPLICATE_TAB`
- Two same-provider tabs bound to the same sanitized conversation thread → `DUPLICATE_THREAD`
- Unsupported or spoofed provider hostnames → blocked

Query strings and URL fragments do **not** make a thread distinct. For example, these are treated as the same conversation:

- `/c/example?utm_source=test`
- `/c/example#bottom`

## Why same-provider sends are serialized

AI Bridge keeps logical-agent state separate by side, but provider-family prompt dispatches are serialized.

If AI A and AI D both use ChatGPT, AI Bridge sends one ChatGPT prompt-dispatch operation at a time. This prevents provider-family races while keeping the two logical agents' generation IDs, conversation provenance, responses, and transcript state isolated.

The dashboard shows:

- `Sending` for the side currently performing the provider-family dispatch
- `Queued` or `Queued #N` for sides waiting behind it

Queue status never exposes raw Chrome tab IDs, provenance IDs, thread keys, full URLs, query strings, or URL fragments.

## Conversation identity and provenance

Before a viewpoint prompt is dispatched, AI Bridge captures a trusted conversation identity containing the logical side, provider family, selected tab, and sanitized conversation thread.

The runtime then re-validates that identity immediately before the actual provider dispatch.

If the tab navigates to another conversation while waiting in the provider-family queue, AI Bridge refuses the dispatch rather than sending the prompt into the new conversation with stale provenance.

If a queued tab closes, the queued send is cancelled immediately.

If final prompt dispatch fails, AI Bridge clears that side's transient viewpoint identity and disarms its generation ID so delayed responses cannot inherit stale provenance.

## Generation isolation

Generation IDs are maintained per logical side.

Replacing or resending AI A does not reset AI D or AI E, even when all of them use the same provider family.

Delayed responses are rejected when:

- the side has been disarmed,
- the generation ID is missing when one is required, or
- the response belongs to an older/superseded generation.

Generation validation happens before completion processing and transcript commit.

## Queue telemetry and privacy

Queue telemetry is kept only in service-worker memory and is not written to Chrome Sync, Google Drive, or persistent session state.

The extension dashboard may receive safe operational data such as:

- logical side
- provider family
- queue position
- waiting/sending state
- wait duration
- queue depth
- completion/rejection counters

It does not expose raw binding identity such as tab IDs, provenance IDs, thread keys, or full URLs.

Queue telemetry is available only to trusted extension pages.

## Service-worker restart behavior

AI Bridge does **not** restore queued sends after a Manifest V3 service-worker restart.

A restored queued dispatch could target stale browser state, so queued work remains intentionally ephemeral. New work must pass fresh tab, thread, binding, and provenance validation.

## Pause semantics

The current global **Pause** control pauses AI Bridge orchestration and watchdog scheduling.

It does **not** currently cancel provider generations or already accepted viewpoint queue work. Changing that behavior would be a separate product-semantics change.

There are currently no per-agent Pause/Resume/Disconnect lifecycle controls. Do not interpret Health or queue badges as those features.

## Provider Health

Provider Health evaluates every selected logical agent and can report states including:

- READY
- GENERATING
- UNREACHABLE
- MISSING_TAB
- UNSUPPORTED
- DUPLICATE_TAB
- DUPLICATE_THREAD

A blocking Health state prevents Start. Same-provider agents on distinct tabs and distinct conversation threads can both be READY.

## Security invariants

These rules are intentional and should not be weakened by later refactors:

- One logical agent maps to one unique Chrome tab.
- Same-provider viewpoints require distinct sanitized conversation threads.
- Exact trusted HTTPS provider hosts only.
- Conversation identity is captured before dispatch and revalidated at dispatch time.
- Same-provider prompt dispatches remain serialized.
- Generation state and viewpoint provenance remain isolated by logical side.
- Stale or superseded completions are rejected before commit.
- Queue state is not restored after worker restart.
- Public queue telemetry never exposes raw tab/thread/provenance identifiers.

## Testing

Portable regression suite:

```text
node tests/run-all.mjs
```

GitHub Actions runs the Node regression suite on Ubuntu, Windows, and macOS and separately loads the unpacked extension in Chromium for MV3/provider-messaging integration coverage.
