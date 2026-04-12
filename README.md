# ClickSub

A browser extension that lets you click words in video subtitles to instantly translate them using the DeepL API. Works on YouTube and SVT Play.

## Features

- **Click a word** in the subtitles to translate it. The video pauses and a tooltip shows the translation.
- **Double-click** to translate the full sentence, where each word is clickable.
- **Click any translated word** in the tooltip to see its reverse translation (back to the source language).
- **Right-click the tooltip** to copy the translation or the original text.
- Handles hyphenated words split across subtitle lines (e.g. "komplett-" / "eringar" is joined into "kompletteringar" for translation).
- **Customize subtitle font size** (8–72px) via extension settings for better readability.
- Supports 29 languages via the DeepL API, with auto-detect for the source language.

## Supported Sites

| Site | Subtitle selector |
|------|-------------------|
| YouTube | `.ytp-caption-segment` |
| SVT Play | `.vtt-cue-teletext` |

## Installation

### Prerequisites

You need a DeepL API key (free tier works). Get one at [deepl.com/your-account/keys](https://www.deepl.com/en/your-account/keys).

### Chrome

1. Run `task build-dirs` to copy files to `out/chrome-build/`
2. Go to `chrome://extensions/`
3. Enable **Developer Mode**
4. Click **Load unpacked** and select `out/chrome-build/`
5. Re-run `task build-dirs` and reload the extension after source changes

### Firefox

1. Run `task build-dirs` to copy files to `out/firefox-build/`
2. Go to `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on**
4. Select `manifest.json` in `out/firefox-build/`
5. Re-run `task build-dirs` and reload the extension after source changes

### Configuration

1. Click the extension icon in the toolbar
2. Select your source and target languages
3. Enter your DeepL API key
4. Click **Save**
5. Optionally, adjust the subtitle font size (8–72px) under the **Appearance** tab

## Usage

1. Play a video with subtitles enabled
2. **Single-click** a word in the subtitles to translate it
3. **Double-click** the subtitles to translate the full sentence
4. Click any translated word in the tooltip to see its reverse translation (back to the source language)
5. The video resumes when you press play, and the tooltip is automatically dismissed

## Development

### Prerequisites

- **Node.js** (v18+) — for running tests
- **[task](https://taskfile.dev/installation/)** — task runner used for build/dev/release
- **jq** — used by the release task to read manifest versions
- **zip** — used by `task build` to package the extension

### Setup

```
npm install
```

`npm install` only pulls in `jsdom` for the unit tests — the extension itself has no runtime dependencies.

### Tasks

| Task | Description |
|------|-------------|
| `task build-dirs` | Copy extension files to `out/chrome-build/` and `out/firefox-build/` for loading as unpacked extensions. Re-run after source changes. |
| `task build-zips` | Package the build directories into zip archives for store submission. |
| `task build` | Run `build-dirs` and `build-zips` (full build). |
| `task test` | Run unit tests (`node --test test/*.test.js`). |
| `task release -- <major\|minor\|patch>` | Bump version in both manifests and `package.json`, commit, tag, and push. |
| `task clean` | Remove the `out/` directory. |

### Adding a New Site

1. Inspect the live subtitle DOM while a video is playing (the subtitle elements are injected dynamically and won't appear in page source)
2. Find a stable, semantic CSS selector for the subtitle text element
3. Add an entry to `SITE_CONFIGS` in `src/content.js` with `subtitleSelector`, `suppressEvents`, and video control methods
4. Add the hostname pattern to `content_scripts[0].matches` in both `manifest.firefox.json` and `manifest.chrome.json`
5. If the site's subtitle elements have `pointer-events: none`, add a CSS override in `src/content.css`
6. Test: single-click word translation, double-click sentence translation, hyphenated words, overlay handling

## Project Structure

```
manifest.firefox.json  - Firefox manifest (MV2)
manifest.chrome.json   - Chrome manifest (MV3)
src/
  utils.js             - Shared pure functions (language resolution, highlighting, DOM helpers)
  content.js           - Injected into video pages; handles clicks, highlighting, tooltips
  content.css          - Highlight styles and pointer-events overrides
  background.js        - Receives translation requests, calls DeepL API
  popup.html           - Settings UI (language selection, API key)
  popup.js             - Settings persistence and API key validation
  icons/               - Extension icons (16, 48, 128px)
assets/
  icon512.png          - 512px source icon
```

## AI Assistance

This project was written with the help of [Claude Code](https://claude.ai/code) (Anthropic).
I am a backend developer without JavaScript experience, so Claude was used to generate and iterate on the extension code throughout development.

## License

See [LICENSE](LICENSE).
