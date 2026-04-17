# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A Chrome/Firefox WebExtension that integrates with YouTube, SVT Play, and svt.se to provide real-time subtitle translation using the DeepL API. No build system — files are loaded directly as an unpacked extension.

- `manifest.firefox.json` — Firefox (MV2)
- `manifest.chrome.json` — Chrome (MV3)
- `src/` — all extension source code (JS, CSS, HTML)
- `src/icons/` — sized PNGs (16, 48, 128px) for the extension manifests
- `assets/icon512.png` — 512px source icon (for store listings / generating smaller sizes)

## Loading the Extension for Development

Since the manifests are named `manifest.firefox.json` / `manifest.chrome.json` (not `manifest.json`), use `task build-dirs` to create loadable directories under `out/`:

1. Run `task build-dirs` to copy files to `out/chrome-build/` and `out/firefox-build/`
2. Open Chrome → `chrome://extensions/` or Firefox → `about:debugging`
3. Enable Developer Mode
4. Click "Load unpacked" and select the `out/chrome-build/` or `out/firefox-build/` directory
5. Re-run `task build-dirs` after changing source files, then reload the extension

## Architecture

Four components communicate via `browser.runtime.sendMessage` (plus a shared utility module). Each JS file defines `const browser = globalThis.browser ?? globalThis.chrome` so the same code works in both Firefox (native `browser` API) and Chrome (`chrome` API):

**utils.js** — pure functions shared between `background.js` and Node.js tests:
- `resolveLanguages(settings, reverse, detectedSourceLang)` — resolves source/target language pair for a DeepL request, handling auto-detect and reverse translation

**content.js** (injected into supported video pages) — handles all user interaction:
- Site-specific behaviour is configured in the `SITE_CONFIGS` object at the top of the file; add new sites there
- Listens for `click` and `dblclick` on subtitle segment elements (selector is per-site)
- Single click: extracts the clicked word using `getCaretPosition()` (a cross-browser wrapper around `caretPositionFromPoint`/`caretRangeFromPoint`), highlights it, requests translation
- Double click: extracts the full sentence across all visible caption segments, highlights it, requests translation
- Renders tooltip with translated text; clicking the translated word (single-click) or any word in the sentence translation (double-click) shows a reverse translation popup (target → source language)

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

## Key Behaviors

- Word boundaries are detected with a Unicode-aware regex `/\p{L}|\d|-/u`
- `highlightSentenceAcrossSegments()` maps sentence text positions across multiple DOM subtitle segments
- `cleanup()` is called when the video resumes to remove highlights and close the popup
- Video is paused when a translation is triggered
- `joinHyphenatedWord()` handles words split across subtitle lines (e.g. "komplett-" / "eringar" → "kompletteringar"). It returns both a joined form (for translation) and the original hyphenated form (for highlighting). The highlight code must walk multiple text nodes since the hyphenated word spans separate `<span>` elements — a single `Range` across nodes will throw `IndexSizeError`.

## Staleness & DOM Re-render Handling

Several mechanisms work together to handle the fact that pausing the video can cause the site to re-render subtitle elements, invalidating captured DOM references:

- **Caret captured immediately**: `caretInSubtitle()` is called synchronously at click time, because the DOM may change after the video is paused.
- **Global text offset**: `getGlobalTextOffset()` converts a (node, charStart) pair into a numeric position in the virtual concatenation of all segments' textContent. This survives DOM re-renders because it's a character position, not a node reference.
- **Subtitle rect captured pre-pause**: `captionElement.getBoundingClientRect()` is called before pausing for tooltip positioning. Some sites (e.g. svt.se portrait videos via React) clear or hide subtitle elements when the video pauses, making post-pause rect queries return all-zero dimensions. Capturing before pause ensures the tooltip always positions above the subtitle area regardless of what the site does to the DOM after pause.
- **`waitForSubtitleSettle()`**: After pausing, waits for the subtitle container's MutationObserver to go quiet (50ms after last mutation, or 150ms timeout if no mutation at all).
- **Re-query after settle**: After the DOM settles, subtitle elements are re-queried from the DOM and `highlightWordAcrossSegments()` uses the saved global offset to find the correct word occurrence in the new nodes.
- **`currentTranslationId`**: Monotonically increasing counter that detects stale async responses. Each click bumps the ID; when a translation response arrives, it's discarded if the ID no longer matches.

## Multi-Path Rendering and `segmentsForCaption`

`SUBTITLE_SELECTOR` is a CSS union across every rendering path for a site (e.g. for svt.se it matches elements from the TextTrack overlay, the `data-rt` React container, and the `VideoPlayerSubtitles__text` element). On sites where multiple paths are active simultaneously, `querySelectorAll(SUBTITLE_SELECTOR)` returns elements from all of them at once.

This matters for two operations:
1. **`globalOffset` arithmetic** in `handleClick`: the offset is computed as a character position in the concatenation of all queried segments. If segment count differs between the pre-pause query (which computed the offset) and the post-settle query (which resolves it), the wrong word is highlighted.
2. **Sentence highlighting** in `handleDoubleClick`: `highlightSentenceAcrossSegments` searches all queried segments in order. If the clicked element belongs to path 3 (portrait) but path 1 (TextTrack) appears earlier in the list, the sentence match lands in the wrong element and highlights nothing visible.

`segmentsForCaption(captionElement)` filters the result of `querySelectorAll(SUBTITLE_SELECTOR)` to only segments that share the direct parent of `captionElement`, making all segment queries path-local. Both handlers use it for every segment query (both pre-pause and post-settle). Any new site that has duplicate or mirrored subtitle containers will be handled correctly without special-casing.

## Highlighting Technique

Both `highlightWordAcrossSegments()` and `highlightSentenceAcrossSegments()` use the same DOM manipulation technique:
1. Clone all childNodes of the target segment (for later restoration via `restoreHighlights()`)
2. Walk text nodes with a `TreeWalker`
3. Use `splitText()` to isolate the character range that needs highlighting
4. Wrap the isolated text node in a `<span class="highlight-translate">`
5. Advance the walker to the remainder node after the split

This is necessary because a word/sentence can span multiple text nodes (e.g. in SVT Play where each subtitle line is a separate `<span>`). A single `Range` across nodes would throw `IndexSizeError`.

## Tooltip Interaction Flow

1. **Word view** (single-click): Shows the translated word in bold. Clicking it highlights the word (yellow background via `.highlight-reverse`) and shows a reverse translation popup above the tooltip (target → source language). Right-click opens a custom context menu with "Copy" / "Copy original".
2. **Sentence view** (double-click): Each word in the translated sentence is rendered as a clickable `<span>`. Clicking any word highlights it (`.highlight-reverse`) and shows a reverse translation popup above the tooltip (uses `reverse: true` in the message to background.js).

**Implementation note**: For sites with `suppressEvents: true`, subtitle word clicks and tooltip/menu interactions use `mousedown` rather than `click`. Some players (notably svt.se portrait videos) attach a document-level capture-phase `click` handler that calls `stopImmediatePropagation()`, preventing any `click` listeners registered after the player from firing. `mousedown` is not intercepted this way. For landscape svt.se, the click event still reaches our handler (our subtitle overlay is outside the player's click-interception area), so the `suppressNextSubtitleClick` flag prevents double-triggering when both mousedown and click fire.

## content.css

- `content.css` is loaded alongside `content.js` by the manifest
- Defines `.highlight-translate` styles (yellow highlight for words/sentences) and `.highlight-reverse` (yellow highlight for the active word in the translation tooltip during reverse translation)
- SVT Play subtitle elements have `pointer-events: none` set by the player's CSS — the `pointer-events: auto !important` override on `.vtt-cue-teletext` and its ancestors is required for `elementsFromPoint()` and click handlers to work
- Uses `div:has(.vtt-cue-teletext)` to target the subtitle container parent without relying on unstable generated class names

## Supported Sites

### YouTube (`www.youtube.com`)
- Subtitle selector: `.ytp-caption-segment`
- `suppressEvents: true` — YouTube's player swallows click events, so `mousedown`/`pointerdown` must be intercepted in capture phase

### SVT Play (`www.svtplay.se`)
- Subtitle selector: `.vtt-cue-teletext`
- Subtitle container: `div.video-player__text-tracks` (parent of the cue elements)
- `suppressEvents: true`
- Uses a standard `<video>` element — pause/play via the HTMLMediaElement API
- The page source fetched at page-load time does **not** contain subtitle elements; they are injected dynamically into the DOM only while the video is playing with subtitles enabled. To inspect subtitle DOM, run the video with subtitles on and query the live DOM (e.g. `document.querySelectorAll('[class*="cue"]')`).
- SVT Play is a Next.js app; CSS class names like `css-1okjmlg` are dynamically generated and unstable — always target semantic class names like `.vtt-cue-teletext` instead
- Each `.vtt-cue-teletext` element contains one `<span>` per subtitle line (e.g. `<span>komplett-</span><span>eringar ...</span>`). `getCaretPosition` returns a text node inside one `<span>`, so the text boundary of a single word may not extend across line breaks. Use `captionElement.textContent` (which concatenates all inner spans) to reason about the full cue text.
- DOM node references captured at click time (via `getCaretPosition`) may become stale after the video is paused (the site may re-render subtitles). Do not rely on node identity (`===`) for previously captured nodes — compare by content or offset instead.

### svt.se (`www.svt.se`)
- Subtitle selector: `.vtt-cue-teletext` (TextTrack overlay path), `[data-rt="subtitles-container"] div:has(> span)` (React DOM fallback), or `[class*="VideoPlayerSubtitles__text"]` (portrait/vertical clip fallback)
- `suppressEvents: true`
- Uses a standard `<video>` element — pause/play via the HTMLMediaElement API
- **Four subtitle rendering paths** (handled in `check()` in priority order):
  1. **Firefox TextTrack**: the browser renders native `.vtt-cue-teletext` DOM elements — no custom overlay needed, used directly as click targets
  2. **Chrome TextTrack**: `track.mode = 'hidden'` suppresses native rendering; a custom `.vtt-cue-teletext` overlay is created from cue data and appended to `video.parentElement`
  3. **Chrome React fallback** (some videos): subtitles appear as DOM elements inside `[data-rt="subtitles-container"]`. Detected via `[data-rt="subtitles-container"] div:has(> span)` and used directly as click targets
  4. **Portrait/vertical clip fallback** (some videos): subtitles appear inside a `VideoPlayerSubtitles__root` overlay directly in the player (no TextTrack, no `data-rt` container). Detected via `[class*="VideoPlayerSubtitles__text"]` and used directly as click targets. Unlike paths 1–3, the aside-panel duplicate is NOT hidden because there is none — the `VideoPlayerSubtitles__root` element IS the primary subtitle renderer
- **Aside-panel duplicate**: for landscape videos, the player also renders a `VideoPlayerSubtitles__container` React component in the page aside — hidden by setting `display: none` whenever paths 1–3 are active. The portrait path (path 4) never sets `originalSubtitleContainer`, so the portrait player's own container is never hidden — this is intentional: for portrait videos the `VideoPlayerSubtitles__root` IS the primary renderer (there is no aside duplicate)
- `data-rt="subtitles-container"` is a stable `data-*` attribute (manually placed by the developers). The Emotion CSS-in-JS class names on its children (e.g. `css-1okjmlg`) are NOT used as selectors because they can change between player versions
- CSS class names use CSS Modules with unstable hash suffixes (e.g. `VideoPlayerSubtitles__container___I3sgk`) — always use `[class*="VideoPlayerSubtitles__"]` prefix selectors, never the full generated class name
- The `VideoPlayerSubtitles__container` may not exist in the DOM when `setup()` first runs (before any cue is active); the hide logic runs in `renderCues()` on every cue change so it catches the element whenever it appears
- The player's document-level capture `click` handler swallows all click events (for play/pause toggling) — this is why tooltip and context menu item interactions use `mousedown` instead of `click`

## Overlay Handling

`findSubtitleAt()` and `caretInSubtitle()` handle the common case where transparent overlay elements sit on top of subtitle text (YouTube's click-capture div, player control overlays, etc.):
- `findSubtitleAt()` uses `elementsFromPoint()` to look through the stacking order for a subtitle element
- `caretInSubtitle()` temporarily hides overlay elements (setting `visibility: hidden`) one by one until `getCaretPosition()` can "see through" to the subtitle text node
- `getCaretPosition()` is a cross-browser wrapper: it prefers the standard `document.caretPositionFromPoint()` (Firefox, Chrome 128+) and falls back to `document.caretRangeFromPoint()` (older Chrome/Blink), normalizing both into `{ offsetNode, offset }`

## Known Issues / TODOs

### Features to consider
- **Error state leaves video paused**: If `handleClick` throws after pausing the video (e.g. extension context lost), the video stays paused with no tooltip and no way to dismiss. A `try/finally` ensuring cleanup on failure would help.

## Setup (fresh clone)

```
npm install
```

## Testing

Run tests with:

```
node --test test/*.test.js
```

## Adding a New Site

1. Inspect the live subtitle DOM while a video is playing (page source will not show subtitle elements)
2. Find a stable, semantic CSS selector for the subtitle text element
3. If the site uses a standard `<video>` element, call `makeVideoSiteConfig(selector)` and add the result to `SITE_CONFIGS` in `content.js`; otherwise write a custom config object with `subtitleSelector`, `suppressEvents`, and video control methods
4. Add the hostname pattern to `content_scripts[0].matches` in both `manifest.firefox.json` and `manifest.chrome.json`
5. If the site's subtitle elements have `pointer-events: none`, add a CSS override in `content.css`
6. If the site renders subtitles in multiple DOM locations simultaneously (player overlay + aside-panel duplicate, accessibility mirror, etc.), add each location's selector to the union in `subtitleSelector` — `segmentsForCaption` will automatically constrain all queries to the clicked element's path, so word and sentence highlighting will work correctly without any extra special-casing
7. Test: single-click word translation, double-click sentence translation, hyphenated words, overlay handling
