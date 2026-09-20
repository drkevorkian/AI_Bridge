# AI Bridge — AI A 1.19.0 Human Test 1

This folder is a runnable **unpacked Chrome extension** copied from the reviewed `AI_OUTPUT/runtime_review/` candidate at commit `0e86d9b4130053cb4b9247fa92bc3275fb9b2d8a`.

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

Studio and Focus restore the original two-pane arrangement.

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


## Human-test fixes in 1.19.0

- Dashboard → Settings and Settings → Dashboard now navigate in the same workspace tab.
- Popup Settings reuses an existing AI Bridge Dashboard/Settings tab when one is already open.
- Classic/Studio/Focus now share one consistent saved layout preference; Classic is the default when none exists.
- Classic uses Runtime + Team on the left, transcript center, and Human Interjection first on the right.
- The stray literal `\n` text has been removed from extension HTML.
- Classic pane width settings now match the actual 20–42% runtime range with a 26% default.

Build label: **AI A 1.19.0 Human Test 1**.
