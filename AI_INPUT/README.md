# AI Bridge — Human Test Build 1.19.1.04-AI-A

This folder is a runnable **unpacked Chrome extension** promoted from the reviewed `AI_OUTPUT/runtime_review/` candidate.

It is intentionally separate from the production/root extension. Production work is paused while this build is under human testing.

## Load it in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the repository's **AI_INPUT** folder.
5. Open the AI provider tabs you want to use (ChatGPT, Grok, Gemini, Claude, or Copilot).
6. Click the **AI Bridge Human Test** extension and open the Dashboard.
7. Refresh/select the provider tabs in the Dashboard before starting a session.

## Classic layout under test

Classic defaults to a three-pane desktop layout:

- **Left:** Runtime and Team.
- **Center:** Shared transcript.
- **Right:** Human Interjection at the top, followed by the remaining controls, Vault, work strategy, sources, limits, and suppressed requests.

Classic is the only workspace layout.

## Human-test priorities

Please test normal relay first, then pause/resume, human interjection, provider-tab refresh, same-provider multi-tab operation, and provider operational errors such as **"Message delivery timed out. Please try again."**

For provider errors, expected safe behavior is:

- the notice is shown as a provider event, not an AI response;
- relay progression pauses;
- AI Bridge does **not** automatically resend the prompt;
- the original dispatch stays correlated so a provider-side retry/recovery can still complete safely.

Automatic trusted New Chat/thread rollover remains visibly **Limited** wherever the current reviewed runtime cannot prove safe provider authority.

## Reporting bugs

For every issue, record:

- what you clicked;
- which provider/AI side was involved;
- what the Dashboard showed;
- whether the provider received the prompt once or more than once;
- whether the wrong text was relayed;
- screenshots or console errors if available.

Do not test against valuable/irreversible provider actions. This is a human-test build, not production integration.

## AI A 1.19.1.04-AI-A packaging/provenance fixes

- Dashboard → Settings and Settings → Dashboard now reuse the current extension tab instead of spawning another tab.
- Removed accidental literal `\\n` text from extension-page markup.
- Classic is the consistent fallback dashboard layout; Classic is the only workspace layout; older Studio/Focus preferences migrate to Classic.
- Settings confirms the saved dashboard layout before returning to Dashboard.





## Build identification

Chrome extension version: **1.19.1**

AI Bridge build/subversion: **1.19.1.04-AI-A**

The numeric Chrome version stays standards-compatible. The build/subversion string increments independently so human testing can confirm exactly which AI-produced build is loaded.


## Classic-only workspace

Classic is the sole supported workspace composition for this test line. Older stored Studio or Focus selections are automatically migrated to Classic. Color themes remain available independently.

## Build provenance

- Chrome extension version: **1.19.1**
- AI Bridge build/subversion: **1.19.1.04-AI-A**
- Manifest is the runtime source of truth for the Popup, Dashboard, and Settings build labels.
- Classic is the sole workspace composition; color themes remain independent.
