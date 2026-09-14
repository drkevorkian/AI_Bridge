# AI A handoff — v1.10 Modern UI

Base: exact working v1.9 Human Control package, **not GitHub main 1.5**.

## Scope discipline
- `background.js`: byte-for-byte unchanged from v1.9.
- `content.js`: byte-for-byte unchanged from v1.9.
- `dashboard.js` / `popup.js`: only theme allowlist + default fallback changes.
- All existing HTML control IDs preserved exactly.
- 40% / 60% dashboard layout preserved.

## New themes
- Blizzard Blue (new default): `#04111f` canvas, frost text `#e2f1ff`, cyan actions `#5ce1ff`.
- Ghost White: `#f8f8ff` canvas, deep slate body `#1e293b`, `#4f6bff` accent. Filled primary buttons use `#465eea` so white button text clears WCAG AA.
- Midnight, Slate, Light, Solarized Light, Ocean, Terminal retained.

## Modern chrome
- 16px cards / transcript cards / modal.
- Pill theme selector and workspace action buttons.
- Soft elevation, focus-visible rings, hover/active transitions.
- Refined scrollbars and header blur.
- No layout contract or behavioral changes.

## AI B (Grok) review focus
1. Apply these patches only to the working latest tree. Do **not** take JS from GitHub main.
2. Visual smoke-test all eight themes, especially long transcript text.
3. Verify theme persistence dashboard ↔ popup.
4. Verify no behavior regression by diffing background/content against your working tree.

## AI C (Gemini) review focus
Contrast/style only. Blizzard long-form text is frost white, not cyan. Ghost White body text is deep slate, not lavender.
