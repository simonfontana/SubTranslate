# Architecture

Four components communicate via `browser.runtime.sendMessage` (plus a shared utility module). Each JS file defines `const browser = globalThis.browser ?? globalThis.chrome` so the same code works in both Firefox (native `browser` API) and Chrome (`chrome` API).

## Components

**utils.js** — pure functions shared between `background.js`, `content.js`, and Node.js tests:
- Language resolution: `resolveLanguages()` resolves source/target language pair for a DeepL request, handling auto-detect and reverse translation; `buildTranslateParams()` builds the DeepL API request body
- Word/sentence extraction: `extractWordAtOffset()`, `joinHyphenatedWord()`, `getFullSentenceFromSubtitles()`, `joinSubtitleParts()`
- Highlighting: `highlightWordAcrossSegments()`, `highlightSentenceAcrossSegments()`, `highlightRangeInSegment()`, `restoreHighlights()` — all DOM manipulation for marking words/sentences in subtitle elements
- Offset arithmetic: `getSegmentOffsets()`, `getGlobalTextOffset()`, `getSearchableText()` — convert DOM positions to global character offsets that survive re-renders
- Subtitle history: `createSubtitleHistory(size)` — ring buffer factory for recording subtitle lines, used as DeepL translation context

**content.js** (injected into supported video pages) — handles all user interaction:
- Site-specific behaviour is configured in the `SITE_CONFIGS` object at the top of the file; add new sites there
- Listens for `click` and `dblclick` on subtitle segment elements (selector is per-site)
- Single click: extracts the clicked word using `getCaretPosition()` (a cross-browser wrapper around `caretPositionFromPoint`/`caretRangeFromPoint`), highlights it, requests translation
- Double click: extracts the full sentence across all visible caption segments, highlights it, requests translation
- Video is paused when a translation is triggered (configurable via the pause-on-translate setting in the Advanced tab; when disabled, translation happens without pausing)
- Recent subtitle lines are recorded in a ring buffer and sent as DeepL context for better word disambiguation
- Renders tooltip with translated text; clicking the translated word (single-click) or any word in the sentence translation (double-click) shows a reverse translation popup (target → source language)
- Right-click on a subtitle word shows a context menu with "Copy" (word), "Copy sentence", and "Look up on Wiktionary" (opens the word's Wiktionary entry, jumping to the source-language section)

**background.js** — translation service layer:
- Listens for `"translate"` messages from content.js
- Fetches DeepL API key and language settings from `browser.storage.local`
- POSTs to the DeepL translate endpoint (`api-free.deepl.com` or `api.deepl.com`, auto-detected from the API key); supports a `reverse` flag that swaps source/target languages

**popup.html + popup.js** — settings UI:
- Three tabs: **General** (source/target language, DeepL API key), **Appearance** (subtitle font size, highlight color), **Advanced** (context history size, translation model, pause-on-translate toggle, reset-to-defaults button)
- All settings auto-save on change (no Save button); most persist immediately, API key is validated against DeepL with an 800ms debounce before saving
- API key field shows plain text while focused, masked on blur
- Settings persisted to `browser.storage.local`; all storage keys and defaults live in `src/constants.js` (`STORAGE_KEY_*` / `DEFAULT_*`) — read from there rather than hardcoding key names
- Reset-to-defaults button on the Advanced tab clears only the advanced settings; language, API key, and appearance are intentionally preserved
- Footer shows DeepL API usage stats (characters used / limit) with a color-coded progress bar (blue → yellow at 75% → red at 90%); fetched from `/v2/usage` on popup open
