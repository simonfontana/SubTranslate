# Supported Sites

## YouTube (`www.youtube.com`)
- Subtitle selector: `.ytp-caption-segment`
- `suppressEvents: true` — YouTube's player swallows click events, so `mousedown`/`pointerdown` must be intercepted in capture phase

## SVT Play (`www.svtplay.se`)
- Subtitle selector: `.vtt-cue-teletext`
- Subtitle container: `div.video-player__text-tracks` (parent of the cue elements)
- `suppressEvents: true`
- Uses a standard `<video>` element — pause/play via the HTMLMediaElement API
- The page source fetched at page-load time does **not** contain subtitle elements; they are injected dynamically into the DOM only while the video is playing with subtitles enabled. To inspect subtitle DOM, run the video with subtitles on and query the live DOM (e.g. `document.querySelectorAll('[class*="cue"]')`).
- SVT Play is a Next.js app; CSS class names like `css-1okjmlg` are dynamically generated and unstable — always target semantic class names like `.vtt-cue-teletext` instead
- Each `.vtt-cue-teletext` element contains one `<span>` per subtitle line (e.g. `<span>komplett-</span><span>eringar ...</span>`). `getCaretPosition` returns a text node inside one `<span>`, so the text boundary of a single word may not extend across line breaks. Use `captionElement.textContent` (which concatenates all inner spans) to reason about the full cue text.
- DOM node references captured at click time (via `getCaretPosition`) may become stale after the video is paused (the site may re-render subtitles). Do not rely on node identity (`===`) for previously captured nodes — compare by content or offset instead.

## svt.se (`www.svt.se`)
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
