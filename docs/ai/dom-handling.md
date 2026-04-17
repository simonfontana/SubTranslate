# DOM Handling — Staleness, Re-renders, and Multi-Path Rendering

## Staleness & DOM Re-render Handling

Several mechanisms work together to handle the fact that pausing the video can cause the site to re-render subtitle elements, invalidating captured DOM references. The pause/settle/re-query flow only runs when pause-on-translate is enabled (the default); when disabled, translations happen on the live DOM without pausing, but the global-offset and pre-pause rect capture still apply:

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
