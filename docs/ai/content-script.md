# content.js — Behaviors, Highlighting, Tooltips, and Overlays

## Key Behaviors

- Word boundaries are detected with a Unicode-aware regex `/\p{L}|\d|-/u`
- `highlightSentenceAcrossSegments()` maps sentence text positions across multiple DOM subtitle segments
- `cleanup()` is called when the video resumes to remove highlights, close the popup, and unfreeze the overlay
- Video is paused when a translation is triggered (unless the user disables pause-on-translate in the Advanced settings tab)
- `joinHyphenatedWord()` handles words split across subtitle lines (e.g. "komplett-" / "eringar" -> "kompletteringar"). It returns both a joined form (for translation) and the original hyphenated form (for highlighting).
- Recent subtitle lines are recorded in a ring buffer (`createSubtitleHistory`) and sent as DeepL translation context for better word disambiguation. The buffer size is configurable in the Advanced settings tab (default 5, set to 0 to disable).
- Settings changes (font size, highlight color, subtitle position) take effect immediately on open translation boxes and subtitles via the `storage.onChanged` handler — no need to dismiss and reopen.

## Overlay Freeze/Unfreeze

When the user clicks a subtitle word:
1. The overlay is **frozen** — it stops accepting cue updates from the adapter
2. The word is highlighted in the frozen overlay (immediate, synchronous)
3. The video is paused (if enabled)
4. Translation is fetched and tooltip is displayed

This eliminates the need for `waitForSubtitleSettle()`, `segmentsForCaption()`, or pre-captured subtitle rects. The overlay DOM is stable because we control it.

On cleanup, the overlay is **unfrozen** and re-renders with the latest cues.

## Highlighting Technique

Both `highlightWordAcrossSegments()` and `highlightSentenceAcrossSegments()` use the same DOM manipulation technique:
1. Clone all childNodes of the target segment (for later restoration via `restoreHighlights()`)
2. Walk text nodes with a `TreeWalker`
3. Use `splitText()` to isolate the character range that needs highlighting
4. Wrap the isolated text node in a `<span class="highlight-translate">`
5. Advance the walker to the remainder node after the split

## Tooltip Interaction Flow

1. **Word view** (single-click): Shows the translated word in bold. Clicking it highlights the word (via `.highlight-reverse`) and shows a reverse translation popup above the tooltip (target -> source language). Right-click opens a custom context menu with "Copy".
2. **Sentence view** (double-click): Each word in the translated sentence is rendered as a clickable `<span>`. Clicking any word highlights it and shows a reverse translation popup. Right-click opens a context menu with "Copy" / "Copy sentence".
3. **All subtitles view** (triple-click): Highlights all visible subtitle segments and translates their joined text. Uses the same sentence-style tooltip as double-click.
3. **Subtitle right-click** (without triggering a translation): Right-clicking a subtitle word shows a context menu with "Copy" (the right-clicked word), "Copy sentence" (the sentence containing that word), and "Look up on Wiktionary".

**Implementation note**: Tooltip and context menu item interactions use `mousedown` rather than `click`. Some sites (notably svt.se) attach a document-level capture-phase `click` handler that calls `stopPropagation()`, preventing `click` listeners on our tooltip elements from firing. `mousedown` is not intercepted this way. This is a defensive pattern for our tooltip UI, not a site-specific hack.

## Caret Detection

`getCaretPosition()` is a cross-browser wrapper: it prefers the standard `document.caretPositionFromPoint()` (Firefox, Chrome 128+) and falls back to `document.caretRangeFromPoint()` (older Chrome/Blink), normalizing both into `{ offsetNode, offset }`.

Since our overlay elements are the topmost clickable layer (high z-index, `pointer-events: auto`), no overlay-hiding logic is needed — `getCaretPosition` works directly on our text nodes.

## content.css

- `content.css` is loaded alongside `content.js` by the manifest
- `.highlight-translate` and `.highlight-reverse` use CSS custom properties (`--subtranslate-highlight`, `--subtranslate-highlight-soft`) set on `<html>` by `applyHighlightColor()` in content.js
- `.subtranslate-subtitle-overlay` positions the overlay inside the video player (`position: absolute; bottom: <subtitlePosition>%`) with `pointer-events: none` on the container (clicks pass through to the player) and `pointer-events: auto` on `.subtranslate-cue` text spans. The vertical position is configurable via the Appearance tab (0–95%, default 10%).
- `.subtranslate-cue .highlight-translate` uses the semi-transparent highlight variant so highlighted text blends with the dark subtitle background
