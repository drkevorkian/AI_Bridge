# AI Bridge — Human Test Build v1.19.0

This folder is the runnable **v1.19.0 unpacked Chrome extension** mirrored from the AI_OUTPUT playground after UI validation.

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

Studio is a full two-pane workspace with all controls on the left. Focus is transcript-first: it keeps only the brand/Settings and Runtime controls in a narrow left rail so the transcript gets most of the screen.

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


## v1.19.0 human-test fixes

- Dashboard → Settings stays in the same extension tab.
- Settings → Dashboard stays in the same extension tab.
- Classic, Studio, and Focus now have visibly different structures.
- Literal `\n` text accidentally rendered by packaged HTML has been removed.
- Classic is the consistent default when no layout preference is stored.
- Human-test versioning now follows the AI Bridge v1.19.x line.
