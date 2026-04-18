# Adding a New Site

1. **Inspect the live subtitle DOM** while a video is playing (page source will not show subtitle elements). Determine how the site renders subtitles: DOM elements via MutationObserver, TextTrack API (`cuechange`), or both (browser-dependent).

2. **Create an adapter** in `src/adapters/<sitename>.js`. The adapter is a factory function (e.g. `createExampleAdapter()`) that returns an object with these methods:
   - `startObserving(onCues)` — observe the site's subtitle rendering and call `onCues(lines)` whenever subtitles change. `lines` is an array of strings (one per cue); empty array = no subtitles visible. Must return a `stop()` function that tears down all observers and restores hidden elements.
   - `getOverlayAnchor()` — return the DOM element to append our overlay to (typically `video.parentElement` or a positioned container inside the player). Must work in fullscreen.
   - `pauseVideo()` / `resumeVideo()` — control the `<video>` element (or the site's player API if no standard `<video>` exists).
   - `onResume(callback)` — register a one-shot listener for when the video resumes playing. Return an unsubscribe function.

3. **Hide the site's native subtitles** inside the adapter. Common strategies:
   - CSS `visibility: hidden` on DOM-rendered subtitle elements (keeps them observable)
   - `track.mode = 'hidden'` for TextTrack-based subtitles (cues stay active but native rendering is suppressed)
   - Use the shared `observeTextTrack(video, onCues)` helper from `src/adapters/texttrack-helper.js` if the site uses the TextTrack API

4. **Register the adapter** in the `ADAPTERS` map at the top of `src/content.js`:
   ```js
   const ADAPTERS = {
       ...
       "www.example.com": createExampleAdapter,
   };
   ```
   Also add the site to the `SITE_INFO` map in `src/constants.js` so per-site settings overrides and the popup scope tabs work:
   ```js
   const SITE_INFO = {
       ...
       "www.example.com": { id: "example", label: "Example" },
   };
   ```

5. **Update both manifests** (`manifest.chrome.json` and `manifest.firefox.json`):
   - Add the hostname pattern to `content_scripts[0].matches`
   - Add `src/adapters/<sitename>.js` to `content_scripts[0].js` (before `src/content.js`)

6. **Test**: single-click word translation, double-click sentence translation, right-click context menu, hyphenated words across lines, fullscreen mode, pause-on-translate on/off.

See [supported-sites.md](supported-sites.md) for examples of existing adapters.
See [dom-handling.md](dom-handling.md) for how the adapter/overlay architecture works.
