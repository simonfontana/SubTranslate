# content.js — Behaviors, Highlighting, Tooltips, and Overlays

## Key Behaviors

- Word boundaries are detected with a Unicode-aware regex `/\p{L}|\d|-/u`
- `highlightSentenceAcrossSegments()` maps sentence text positions across multiple DOM subtitle segments
- `cleanup()` is called when the video resumes to remove highlights and close the popup
- Video is paused when a translation is triggered (unless the user disables pause-on-translate in the Advanced settings tab)
- `joinHyphenatedWord()` handles words split across subtitle lines (e.g. "komplett-" / "eringar" → "kompletteringar"). It returns both a joined form (for translation) and the original hyphenated form (for highlighting). The highlight code must walk multiple text nodes since the hyphenated word spans separate `<span>` elements — a single `Range` across nodes will throw `IndexSizeError`.
- Recent subtitle lines are recorded in a ring buffer (`createSubtitleHistory`) and sent as DeepL translation context for better word disambiguation. The buffer size is configurable in the Advanced settings tab (default 5, set to 0 to disable).

## Highlighting Technique

Both `highlightWordAcrossSegments()` and `highlightSentenceAcrossSegments()` use the same DOM manipulation technique:
1. Clone all childNodes of the target segment (for later restoration via `restoreHighlights()`)
2. Walk text nodes with a `TreeWalker`
3. Use `splitText()` to isolate the character range that needs highlighting
4. Wrap the isolated text node in a `<span class="highlight-translate">`
5. Advance the walker to the remainder node after the split

This is necessary because a word/sentence can span multiple text nodes (e.g. in SVT Play where each subtitle line is a separate `<span>`). A single `Range` across nodes would throw `IndexSizeError`.

## Tooltip Interaction Flow

1. **Word view** (single-click): Shows the translated word in bold. Clicking it highlights the word (via `.highlight-reverse`) and shows a reverse translation popup above the tooltip (target → source language). Right-click opens a custom context menu with "Copy".
2. **Sentence view** (double-click): Each word in the translated sentence is rendered as a clickable `<span>`. Clicking any word highlights it (`.highlight-reverse`) and shows a reverse translation popup above the tooltip (uses `reverse: true` in the message to background.js). Right-click opens a context menu with "Copy" / "Copy sentence".
3. **Subtitle right-click** (without triggering a translation): Right-clicking a subtitle word shows a context menu with "Copy" (the right-clicked word), "Copy sentence" (the sentence containing that word), and "Look up on Wiktionary" (opens the word's en.wiktionary.org entry, jumping to the source-language section via `DEEPL_TO_WIKTIONARY_LANG`).

**Implementation note**: For sites with `suppressEvents: true`, subtitle word clicks and tooltip/menu interactions use `mousedown` rather than `click`. Some players (notably svt.se portrait videos) attach a document-level capture-phase `click` handler that calls `stopImmediatePropagation()`, preventing any `click` listeners registered after the player from firing. `mousedown` is not intercepted this way. For landscape svt.se, the click event still reaches our handler (our subtitle overlay is outside the player's click-interception area), so the `suppressNextSubtitleClick` flag prevents double-triggering when both mousedown and click fire.

## Overlay Handling

`findSubtitleAt()` and `caretInSubtitle()` handle the common case where transparent overlay elements sit on top of subtitle text (YouTube's click-capture div, player control overlays, etc.):
- `findSubtitleAt()` uses `elementsFromPoint()` to look through the stacking order for a subtitle element
- `caretInSubtitle()` temporarily hides overlay elements (setting `visibility: hidden`) one by one until `getCaretPosition()` can "see through" to the subtitle text node
- `getCaretPosition()` is a cross-browser wrapper: it prefers the standard `document.caretPositionFromPoint()` (Firefox, Chrome 128+) and falls back to `document.caretRangeFromPoint()` (older Chrome/Blink), normalizing both into `{ offsetNode, offset }`

## content.css

- `content.css` is loaded alongside `content.js` by the manifest
- `.highlight-translate` and `.highlight-reverse` use CSS custom properties (`--subtranslate-highlight`, `--subtranslate-highlight-soft`) set on `<html>` by `applyHighlightColor()` in content.js from the user's stored color preference, with yellow fallback defaults
- SVT Play `.vtt-cue-teletext` gets a semi-transparent highlight variant and inherits the cue's own text color/size so highlighted text blends with the player's subtitle styling
- `pointer-events: auto !important` overrides on `.vtt-cue-teletext` and `div:has(.vtt-cue-teletext)` (SVT Play), `[data-rt="subtitles-container"]` (svt.se React subtitles), and `[class*="VideoPlayerSubtitles__root"]` (svt.se portrait subtitles) — all needed because these players set `pointer-events: none` on subtitle elements
- `.subtranslate-subtitle-container` styles the custom subtitle overlay created by the Chrome TextTrack path for SVT Play / svt.se (positioned at bottom of video, styled to match native subtitles)
