# AI Bridge v1.7 fresh-chat control review

Apply these patches on top of the current v1.6 TEAM FINAL tree, not directly onto v1.5 main.

Purpose: let the human start new provider conversations from AI Bridge while reusing already-open AI tabs.

Behavior:
- `Start in fresh AI chats` is checked by default. Start resets A/B/C to new provider conversations before sending the first prompt.
- `New AI chats` resets all selected A/B/C tabs without starting a bridge session.
- Each agent card has an idle-only `New chat` button.
- No replacement AI tabs are created. The selected webpages must already be open.
- Fresh-chat controls are locked while a bridge session is active.
- Fresh-chat resets do not increment AI turns.
- Provider routes: ChatGPT root, Grok root, Claude `/new`, Gemini `/app`, Copilot root. The content script first tries a visible New chat/New conversation/New topic control, then the background uses the canonical route fallback.
- v1.7 content-script ping is versioned. A still-open v1.6 listener is detected and its tab is refreshed once before v1.7 injection, preventing duplicate v1.6/v1.7 SEND listeners.

AI B review focus:
1. Test Start with fresh chats across the actual three chosen providers.
2. Confirm the initial bridge prompt is sent only after all requested tabs have finished their reset.
3. Challenge provider-specific fresh-chat selectors/routes if a current UI no longer resets correctly.
4. Preserve the active-session lock; do not allow a casual New chat click to erase an in-progress agent context.
5. Re-run artifact relay and `-1` infinite-turn tests.

AI C review focus:
- Check the runtime `Start in fresh AI chats` row and per-agent New chat buttons for density in the 40% control pane.
- No new coding is required unless spacing/wording needs adjustment.

Candidate ZIP SHA-256: `8a60aa6bc84daf81b0866bd2cec919bbcf50029d4b4b6b31f62e9e6a263db62e`.
