# Architecture

Five component layers communicate via `browser.runtime.sendMessage` (plus shared utilities). Each JS file defines `const browser = globalThis.browser ?? globalThis.chrome` so the same code works in both Firefox (native `browser` API) and Chrome (`chrome` API).

## Components

**utils.js** — pure functions shared between `background.js`, `content.js`, and Node.js tests:
- Language resolution: `resolveLanguages()` resolves source/target language pair for a DeepL request, handling auto-detect and reverse translation; `buildTranslateParams()` builds the DeepL API request body
- Word/sentence extraction: `extractWordAtOffset()`, `joinHyphenatedWord()`, `getFullSentenceFromSubtitles()`, `joinSubtitleParts()`
- Highlighting: `highlightWordAcrossSegments()`, `highlightSentenceAcrossSegments()`, `highlightRangeInSegment()`, `restoreHighlights()` — all DOM manipulation for marking words/sentences in subtitle elements
- Offset arithmetic: `getSegmentOffsets()`, `getGlobalTextOffset()`, `getSearchableText()` — convert DOM positions to global character offsets that survive re-renders
- Subtitle history: `createSubtitleHistory(size)` — ring buffer factory for recording subtitle lines, used as DeepL translation context

**adapters/** (per-site subtitle observation) — each adapter observes the site's native subtitle DOM, extracts text, hides the originals, and reports cue changes:
- `texttrack-helper.js` — shared helper for sites that render subtitles via the browser's TextTrack API (SVT Play Chrome, svt.se Chrome)
- `youtube.js` — observes `.ytp-caption-segment` mutations, hides `.caption-window` via CSS
- `svtplay.js` — two paths: Firefox native DOM (MutationObserver) or Chrome TextTrack (cuechange)
- `svtse.js` — four paths in priority order: Firefox TextTrack DOM, Chrome TextTrack, React DOM, portrait/vertical clip

**subtitle-overlay.js** — shared subtitle renderer that receives cue text from the adapter and renders it in our own `.subtranslate-cue` spans. Supports freeze/unfreeze for translation interactions.

**content.js** (injected into supported video pages) — handles all user interaction:
- Selects the adapter for the current site and wires it to the overlay
- Listens for `click` and `dblclick` on `.subtranslate-cue` elements (same for all sites)
- Single click: extracts the clicked word using `getCaretPosition()`, highlights it, requests translation
- Double click: extracts the full sentence across all visible cue segments, highlights it, requests translation
- Video is paused when a translation is triggered (configurable via the pause-on-translate setting)
- Recent subtitle lines are recorded in a ring buffer and sent as DeepL context for word disambiguation
- Renders tooltip with translated text; clicking the translated word shows a reverse translation popup
- Right-click on a subtitle word shows a context menu with "Copy", "Copy sentence", and "Look up on Wiktionary"

**background.js** — translation service layer:
- Listens for `"translate"` messages from content.js
- Resolves DeepL API key and language settings from `browser.storage.local` via `getEffectiveSetting()`, respecting per-site overrides when the message includes a site ID
- POSTs to the DeepL translate endpoint; supports a `reverse` flag that swaps source/target languages

**popup.html + popup.js** — settings UI:
- Three tabs: **General** (source/target language, DeepL API key), **Appearance** (subtitle font size, subtitle vertical position, highlight color), **Advanced** (context history size, translation model, pause-on-translate toggle, reset-to-defaults button)
- **Per-site overrides**: scope tabs at the top let the user switch between Global and site-specific settings (YouTube, SVT Play, svt.se). Per-site overrides are stored under the `siteOverrides` storage key, keyed by site ID. When no override is set for a key, the global value is used as fallback. Resolution is handled by `getEffectiveSetting()` in `constants.js`.
- `SITE_INFO` in `constants.js` maps hostnames to site IDs and labels, shared by the popup, content.js, and background.js
- All settings auto-save on change; API key is validated against DeepL with an 800ms debounce
- Settings persisted to `browser.storage.local`; all storage keys and defaults live in `src/constants.js`

## Data Flow

```
Site DOM  -->  [Adapter]  --cue text-->  [Overlay]  <--clicks/highlights--  [content.js]  --translate-->  [background.js]  -->  DeepL API
                (per site)              (shared)                            (shared)
```
