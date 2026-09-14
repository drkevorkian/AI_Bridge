# AI Bridge 1.3

AI Bridge is a Manifest V3 Chrome extension that coordinates a persistent three-AI conversation through the web interfaces of supported AI services.

Supported sites:
- ChatGPT: chatgpt.com and chat.openai.com
- Grok: grok.com
- Claude: claude.ai
- Gemini: gemini.google.com
- Microsoft Copilot: copilot.microsoft.com

## New in 1.3

### Three AI agents
Bind three different supported chat tabs as **AI A**, **AI B**, and **AI C**. The normal turn order is A → B → C → A, rotated so whichever AI you choose as the starter speaks first.

### A separate job for every AI
Each agent has a persistent Job / Responsibility field. Every handoff reminds the model of:
- its own assigned job;
- the jobs of the other two agents;
- the human controller's primary objective;
- the shared updates it has not seen since its previous handoff.

Example team:
- AI A: Lead architect / planner
- AI B: Red-team critic / failure-mode hunter
- AI C: Verifier / calculation checker / decision synthesizer

### Persistent shared transcript and per-AI cursors
AI Bridge stores completed agent responses and human interventions in `chrome.storage.local`. Each AI has a delivery cursor. On a normal turn it receives the new shared work that happened since its previous handoff, so adding a third AI does not reduce the conversation to three isolated pairwise chats.

### Pause and Resume
**Pause** preserves the objective, jobs, turn counter, current speaker, transcript, and per-AI handoff positions.

**Resume** reconnects the three currently selected tabs and sends the current agent a recovery packet containing:
- its assigned job and team roster;
- the original human objective;
- the recent stored shared transcript;
- an instruction to continue instead of restarting.

If one of the three tabs closes, the session is paused rather than destroyed. Open/reselect a replacement chat tab for that role and press **Resume**.

### Service-worker recovery
v1.3 no longer intentionally clears the active session when Chrome unloads/restarts the Manifest V3 background service worker. State is restored from local extension storage. If stored tab bindings no longer exist, the bridge pauses and asks you to reconnect them.

### Human intervention
Any AI can request the controller with:

`[[HUMAN_INPUT: your question to the human]]`

The relay pauses, displays a `!` badge, shows the question in the popup, and waits for your response. The human answer is stored in the shared transcript.

### Resend controls
AI A, AI B, and AI C each have their own **Resend** button for retrying the last handoff to that agent.

## Install / update

1. Extract the ZIP to a permanent folder.
2. Open `chrome://extensions/`.
3. Enable **Developer mode**.
4. If this is a new install, click **Load unpacked** and select the extracted `ai_bridge_chrome` folder containing `manifest.json`.
5. If updating an existing unpacked AI Bridge, replace the old files with the v1.3 files and click **Reload** on the AI Bridge extension card.
6. Existing supported AI tabs should normally self-heal through automatic content-script reinjection. Refresh a page once if its website prevents reinjection after an extension update.

## Use

1. Open three supported AI chats in separate tabs.
2. Open AI Bridge.
3. Assign tabs to AI A, AI B, and AI C.
4. Give each AI a job.
5. Choose which AI starts.
6. Enter the shared primary objective.
7. Choose max turns and relay delay.
8. Click **Start new**.
9. Use **Pause** whenever you want to stop automatic forwarding without losing the session.
10. Rebind tabs if necessary and click **Resume** to pick up from the saved state.
11. Use **Stop** only when you want to end the resumable session.

## Important behavior

The extension drives AI websites' DOMs; it does not use their APIs. Website markup changes can therefore break individual adapters. The relevant prompt-box, send-button, response, and stop-generation selectors live in `content.js`.

AI Bridge intentionally includes duplicate-response guards, automatic content-script reinjection, a hard turn limit, human intervention, per-agent resend, persistent state, and tab-loss recovery.

Use automation in accordance with each service's applicable terms and rate limits.
