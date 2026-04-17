# Adding a New Site

1. Inspect the live subtitle DOM while a video is playing (page source will not show subtitle elements)
2. Find a stable, semantic CSS selector for the subtitle text element
3. If the site uses a standard `<video>` element, call `makeVideoSiteConfig(selector)` and add the result to `SITE_CONFIGS` in `content.js`; otherwise write a custom config object with `subtitleSelector`, `suppressEvents`, and video control methods
4. Add the hostname pattern to `content_scripts[0].matches` in both `manifest.firefox.json` and `manifest.chrome.json`
5. If the site's subtitle elements have `pointer-events: none`, add a CSS override in `content.css`
6. If the site renders subtitles in multiple DOM locations simultaneously (player overlay + aside-panel duplicate, accessibility mirror, etc.), add each location's selector to the union in `subtitleSelector` — `segmentsForCaption` will automatically constrain all queries to the clicked element's path, so word and sentence highlighting will work correctly without any extra special-casing
7. Test: single-click word translation, double-click sentence translation, hyphenated words, overlay handling

See [supported-sites.md](supported-sites.md) for examples of how existing sites are configured.
See [dom-handling.md](dom-handling.md) for how multi-path rendering and stale DOM references are handled automatically.
