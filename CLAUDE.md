# CLAUDE.md

This file provides guidance to agents when working in this repository.

## Overview

A Chrome/Firefox WebExtension that integrates with YouTube, SVT Play, and svt.se to provide real-time subtitle translation using the DeepL API.

- `manifest.firefox.json` — Firefox (MV2)
- `manifest.chrome.json` — Chrome (MV3)
- `src/` — all source code (JS, CSS, HTML)
- `src/icons/` — sized PNGs for the extension manifests
- `assets/icon512.png` — 512px source icon

## Build

No build system — files load directly as an unpacked extension. After editing source files, run `task build-dirs` to copy them to `out/chrome-build/` or `out/firefox-build/`, then reload the extension in the browser. Run tests with `task test`.

## Detailed Documentation

Deeper reference material lives in [docs/ai/](docs/ai/):

| Document | When to read it |
|---|---|
| [architecture.md](docs/ai/architecture.md) | Component overview — background.js, content.js, popup, utils.js and how they communicate |
| [content-script.md](docs/ai/content-script.md) | Key behaviors in content.js: word/sentence detection, highlighting, tooltip flow, overlay handling, content.css |
| [dom-handling.md](docs/ai/dom-handling.md) | How stale DOM references and multi-path subtitle rendering are handled |
| [supported-sites.md](docs/ai/supported-sites.md) | Per-site details for YouTube, SVT Play, and svt.se |
| [adding-new-site.md](docs/ai/adding-new-site.md) | Step-by-step guide for adding support for a new site |
