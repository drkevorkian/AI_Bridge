# Artifact relay implementation map

This maps the AI A candidate changes against v1.5 `main`.

## `background.js`

Add constants:

```js
const MAX_RELAY_ARTIFACTS = 24;
const MAX_ARTIFACTS_PER_RESPONSE = 8;
const MAX_ARTIFACT_FILE_BYTES = 12 * 1024 * 1024;
const MAX_ARTIFACT_TOTAL_BYTES = 24 * 1024 * 1024;
const MAX_RELAY_ARTIFACT_TOTAL_BYTES = 60 * 1024 * 1024;
```

Add state fields:

```js
relayArtifacts: [],
lastSentArtifactIdsBySide: { A: [], B: [], C: [] },
```

Keep binary payloads outside normal bridge state:

```js
let artifactStore = {};

async function saveArtifacts() {
  await chrome.storage.local.set({ bridgeArtifacts: artifactStore });
}
```

Incoming response artifacts are validated before retention. Filenames replace slashes/NUL, max 8/response, 12 MiB/file, 24 MiB/response. Retained metadata is appended to `state.relayArtifacts`; the payload is stored by generated artifact ID in `artifactStore`. Evict oldest until <=24 retained files and <=60 MiB.

A completed response becomes conceptually:

```js
const entry = recordTranscript("response", { side, text });
const artifactIds = await storeResponseArtifacts(side, entry.seq, artifacts);
if (artifactIds.length) entry.artifactIds = artifactIds;
```

For a normal turn, derive files from the unseen transcript entries, just like text context:

```js
const artifactIds = artifactIdsFromEntries(unseen);
const artifacts = artifactRecordsForIds(artifactIds);
```

`normalTurnMessage()` returns `{ text, deliveredSeq, deliveredSources, artifactIds, artifacts }`. `recoveryMessage()` returns all retained files because Resume may be a fresh conversation.

`sendToSide()` sends:

```js
chrome.tabs.sendMessage(tabId, {
  type: "AI_BRIDGE_SEND",
  text,
  artifacts
});
```

and MUST verify:

```js
if (artifacts.length && Number(result.uploadedCount) !== artifacts.length) {
  throw new Error(`The page attached ${Number(result.uploadedCount) || 0} of ${artifacts.length} relay files.`);
}
```

On a recorded successful send, save `lastSentArtifactIdsBySide[side] = artifactIds`. Resend resolves those IDs back to payloads and repeats them.

Start of a brand-new session clears `bridgeArtifacts`. Stop does not immediately erase the shelf so the just-completed session remains inspectable; next Start clears it.

Load `bridgeArtifacts` alongside bridgeState/history and prune metadata IDs whose payload is missing.

Also remove the existing duplicate `await saveState()` in automatic reconnect failure handling.

## `content.js`

Bump guard to `__AI_BRIDGE_LOADED_V16__`.

Each adapter gets generic upload hooks:

```js
fileInputSelectors: ["input[type='file']"],
uploadButtonSelectors: [/* Attach / Upload / Add variants */]
```

Before prompt send, decode artifact payloads and attach them:

```js
function base64ToFile(item) {
  const binary = atob(item.dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], item.name, { type: item.mime, lastModified: Date.now() });
}
```

Use `DataTransfer`, assign `input.files`, dispatch bubbling `input` + `change`, wait for provider UI, then set/send prompt. If no file input is present, click a provider attach/upload button and poll briefly for the input. If it never appears, throw.

Response capture uses the latest assistant response element and only anchors that look like actual downloads: `download` attribute, blob/data/sandbox URLs, explicit download/attachment UI semantics, or interpreter/download routes. Do NOT capture every `.zip`/`.js` hyperlink merely because of its extension.

For HTTP(S)/blob/data candidates:

```js
const response = await fetch(url, { credentials: "include", signal });
const blob = await response.blob();
```

Then base64-encode and send with the response message:

```js
chrome.runtime.sendMessage({
  type: "AI_BRIDGE_RESPONSE",
  text,
  artifacts
});
```

ChatGPT sandbox fallback is only attempted when all are true:

- host is chatgpt.com/chat.openai.com
- href begins `sandbox:/mnt/data/`
- current pathname exposes `/c/{conversationId}`
- response/ancestor exposes `data-message-id`

Then form the current-conversation interpreter download URL. Never accept a sandbox path outside `/mnt/data/`.

Use a cheap anchor-link signature before fetching bytes so the 650 ms monitor does not redownload the same ZIP repeatedly after a response has already been reported.

## UI / themes

`dashboard.html`: add Forest, Ocean, Ember options and a `Shared AI files` metadata shelf below Local code/files.

`dashboard.js`: `THEMES` includes six values. `renderRelayArtifacts()` uses only `textContent`; show filename, producer side, size, and transcript sequence.

`dashboard.css` + `popup.css`: add Forest/Ocean/Ember variable blocks. Keep the existing `grid-template-columns: 40% 60%`.

`popup.html`: add the same three options. `popup.js`: accept all six theme keys.

`manifest.json`: candidate version `1.6.0`; add `https://*.oaiusercontent.com/*` to host permissions for fetchable ChatGPT file URLs that resolve there.
