# AI_INPUT — generated human-test mirror

`AI_INPUT/` is the runnable human-test mirror of `AI_OUTPUT/runtime_review/`.

**Single source of truth:** `AI_OUTPUT/runtime_review/`

Do not independently edit runtime files in this folder. Update the reviewed runtime first, then regenerate AI_INPUT with:

```bash
node scripts/sync-ai-input.mjs
```

The sync copies every runtime file from `AI_OUTPUT/runtime_review/` except this AI_INPUT-specific README and removes obsolete generated files.

Validate the mirror with:

```bash
node tests/ai-input-source-sync.mjs
```

The test fails if the two runtime file sets or bytes differ.

## Chrome testing

1. Pull the latest repository.
2. Load the repository's `AI_INPUT` folder as an unpacked extension.
3. The build shown by Chrome comes directly from the mirrored `AI_OUTPUT/runtime_review/manifest.json` `version_name`.
4. After updating/reloading the extension, refresh already-open provider tabs once so the matching content runtime is injected.

This prevents AI_INPUT from silently remaining on an older human-test build while reviewed work advances under AI_OUTPUT.
