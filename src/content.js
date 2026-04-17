// Firefox exposes a native Promise-based `browser` API; Chrome uses `chrome`.
const browser = globalThis.browser ?? globalThis.chrome;

// Factory for sites that use a standard <video> element and only differ by subtitle selector.
function makeVideoSiteConfig(subtitleSelector) {
    return {
        subtitleSelector,
        suppressEvents: true, // suppress mousedown/pointerdown so we beat the site's handlers
        getVideoElement() {
            return document.querySelector("video");
        },
        pauseVideo() {
            const video = this.getVideoElement();
            if (video) video.pause();
        },
        resumeVideo() {
            const video = this.getVideoElement();
            if (video) video.play();
        },
        // Register a one-shot listener for when the video resumes playing.
        // Returns an unsubscribe function so the caller can cancel if needed.
        onResume(callback) {
            const video = this.getVideoElement();
            if (!video) return () => {};
            const handler = () => { callback(); video.removeEventListener("play", handler); };
            video.addEventListener("play", handler);
            return () => video.removeEventListener("play", handler);
        },
    };
}

const SITE_CONFIGS = {
    "www.youtube.com": makeVideoSiteConfig(".ytp-caption-segment"),
    "www.svtplay.se":  makeVideoSiteConfig(".vtt-cue-teletext"),
    "www.svt.se":      makeVideoSiteConfig('.vtt-cue-teletext, [data-rt="subtitles-container"] div:has(> span), [class*="VideoPlayerSubtitles__text"]'),
};

const siteConfig = SITE_CONFIGS[window.location.hostname];
if (!siteConfig) throw new Error(`[subtranslate] No config for ${window.location.hostname}`);
const SUBTITLE_SELECTOR = siteConfig.subtitleSelector;

let subtitleFontSize = DEFAULT_SUBTITLE_FONT_SIZE;

// Inject a <style> element to override subtitle font size via CSS.
// CSS rules apply automatically to all matching elements (current and future),
// which handles YouTube's word-by-word subtitle rendering without observers.
const subtitleStyleEl = document.createElement("style");
document.head.appendChild(subtitleStyleEl);
function updateSubtitleSizeRule(size) {
    subtitleStyleEl.textContent = `${SUBTITLE_SELECTOR} { font-size: ${size}px !important; }`;
}

browser.storage.local.get(STORAGE_KEY_SUBTITLE_FONT_SIZE).then(data => {
    if (data[STORAGE_KEY_SUBTITLE_FONT_SIZE]) subtitleFontSize = data[STORAGE_KEY_SUBTITLE_FONT_SIZE];
    updateSubtitleSizeRule(subtitleFontSize);
});
browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY_SUBTITLE_FONT_SIZE]) {
        subtitleFontSize = changes[STORAGE_KEY_SUBTITLE_FONT_SIZE].newValue || DEFAULT_SUBTITLE_FONT_SIZE;
        updateSubtitleSizeRule(subtitleFontSize);
    }
});

// Apply the user's highlight color via CSS custom properties on <html>.
// Two variables are set: a solid color and a 40%-alpha variant used by the
// reverse-translation popup and the SVT Play cue override (see content.css).
function applyHighlightColor(hex) {
    const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex : DEFAULT_HIGHLIGHT_COLOR;
    const r = parseInt(normalized.slice(1, 3), 16);
    const g = parseInt(normalized.slice(3, 5), 16);
    const b = parseInt(normalized.slice(5, 7), 16);
    const root = document.documentElement;
    root.style.setProperty("--subtranslate-highlight", normalized);
    root.style.setProperty("--subtranslate-highlight-soft", `rgba(${r}, ${g}, ${b}, 0.4)`);
}

browser.storage.local.get(STORAGE_KEY_HIGHLIGHT_COLOR).then(data => {
    applyHighlightColor(data[STORAGE_KEY_HIGHLIGHT_COLOR] || DEFAULT_HIGHLIGHT_COLOR);
});
browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY_HIGHLIGHT_COLOR]) {
        applyHighlightColor(changes[STORAGE_KEY_HIGHLIGHT_COLOR].newValue || DEFAULT_HIGHLIGHT_COLOR);
    }
});

// SVT Play (Chrome): the browser renders subtitles via native TextTrack / ::cue
// inside the video element's internal rendering, not as DOM elements we can click.
// Detect this case and create a custom clickable overlay from the TextTrack cue data.
if (window.location.hostname === 'www.svtplay.se' || window.location.hostname === 'www.svt.se') {
    (function initCustomSubtitles() {
        let overlay = null;
        let currentTrack = null;
        let originalSubtitleContainer = null;

        // Hide the site's own subtitle container (aside-panel duplicate on landscape videos).
        // Idempotent — safe to call on every cue change for lazy discovery. Does nothing on
        // sites/paths (e.g. portrait videos) that never have an aside-panel duplicate.
        function hideOriginalSubtitleContainer() {
            if (!originalSubtitleContainer) {
                originalSubtitleContainer = document.querySelector('[class*="VideoPlayerSubtitles__container"]');
            }
            if (originalSubtitleContainer) originalSubtitleContainer.style.display = 'none';
        }

        function renderCues() {
            if (!overlay || !currentTrack) return;
            overlay.innerHTML = '';
            // May not exist at setup() time; check on every cue change until found.
            hideOriginalSubtitleContainer();
            const cues = currentTrack.activeCues;
            if (!cues) return;
            for (let i = 0; i < cues.length; i++) {
                const el = document.createElement('span');
                el.className = 'vtt-cue-teletext';
                // Strip VTT formatting tags; split lines into spans
                // (matches SVT Play's Firefox DOM: one <span> per subtitle line)
                const text = cues[i].text.replace(/<[^>]*>/g, '');
                for (const line of text.split('\n')) {
                    const span = document.createElement('span');
                    span.textContent = line;
                    el.appendChild(span);
                }
                overlay.appendChild(el);
            }
        }

        function setup(video, track) {
            if (currentTrack === track) return;
            if (currentTrack) currentTrack.removeEventListener('cuechange', renderCues);
            currentTrack = track;
            track.mode = 'hidden'; // keep cues active but hide native rendering
            hideOriginalSubtitleContainer();
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'subtranslate-subtitle-container';
                video.parentElement.appendChild(overlay);
                browser.storage.local.get(STORAGE_KEY_SUBTITLE_FONT_SIZE).then(data => {
                    overlay.style.fontSize = (data[STORAGE_KEY_SUBTITLE_FONT_SIZE] || DEFAULT_SUBTITLE_FONT_SIZE) + "px";
                });
                browser.storage.onChanged.addListener((changes, area) => {
                    if (area === "local" && changes[STORAGE_KEY_SUBTITLE_FONT_SIZE]) {
                        overlay.style.fontSize = (changes[STORAGE_KEY_SUBTITLE_FONT_SIZE].newValue || DEFAULT_SUBTITLE_FONT_SIZE) + "px";
                    }
                });
            }
            track.addEventListener('cuechange', renderCues);
            renderCues();
        }

        function check() {
            // Firefox renders custom .vtt-cue-teletext DOM elements — no overlay needed
            if (document.querySelector('.vtt-cue-teletext:not(.subtranslate-subtitle-container .vtt-cue-teletext)')) return true;
            const video = document.querySelector('video');
            if (!video) return false;
            for (let i = 0; i < video.textTracks.length; i++) {
                if (video.textTracks[i].mode === 'showing') {
                    setup(video, video.textTracks[i]);
                    return true;
                }
            }
            // Fallback: some svt.se videos render subtitles as React DOM elements directly in the
            // player's subtitles-container (no TextTrack). Use them directly; hide the aside-panel duplicate.
            if (document.querySelector('[data-rt="subtitles-container"] div:has(> span)')) {
                hideOriginalSubtitleContainer();
                return true;
            }
            // Fallback: some svt.se videos (e.g. portrait/vertical clips) render subtitles via a
            // VideoPlayerSubtitles__root overlay inside the player. Use them directly — do NOT hide
            // the container, as it is the primary subtitle renderer (not an aside duplicate).
            if (document.querySelector('[class*="VideoPlayerSubtitles__text"]')) return true;
            return false;
        }

        function watchTextTracks(video) {
            if (video._subtranslateTrackWatch) return;
            video._subtranslateTrackWatch = true;
            video.textTracks.addEventListener('change', () => {
                if (currentTrack && currentTrack.mode === 'disabled') {
                    // User turned off subtitles
                    if (overlay) overlay.innerHTML = '';
                    currentTrack.removeEventListener('cuechange', renderCues);
                    currentTrack = null;
                    if (originalSubtitleContainer) {
                        originalSubtitleContainer.style.display = '';
                        originalSubtitleContainer = null;
                    }
                    return;
                }
                // A track was switched to 'showing' — find and set it up
                for (let i = 0; i < video.textTracks.length; i++) {
                    if (video.textTracks[i].mode === 'showing') {
                        setup(video, video.textTracks[i]);
                        return;
                    }
                }
            });
        }

        const timer = setInterval(() => {
            const video = document.querySelector('video');
            if (!video) return;
            watchTextTracks(video);
            if (check()) clearInterval(timer);
        }, SUBTITLE_POLL_INTERVAL_MS);
    })();
}

// Monotonically increasing ID used to discard stale translation responses.
// Each new click/dblclick bumps this; when the async response arrives, it's
// compared against currentTranslationId — if they differ, the result is outdated.
let currentTranslationId = 0;
let lastTooltip = null;

// Ring buffer for subtitle history — used to build DeepL translation context.
// Recreated when the user changes the history size (losing any already-captured history,
// which is acceptable — translation context is ephemeral by nature).
let subtitleHistory = createSubtitleHistory(DEFAULT_CONTEXT_HISTORY_SIZE);
const recordSubtitle = (text) => subtitleHistory.record(text);
const getSubtitleContext = () => subtitleHistory.getContext();

browser.storage.local.get(STORAGE_KEY_CONTEXT_HISTORY_SIZE).then(data => {
    const size = data[STORAGE_KEY_CONTEXT_HISTORY_SIZE];
    if (typeof size === "number") subtitleHistory = createSubtitleHistory(size);
});
browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY_CONTEXT_HISTORY_SIZE]) {
        const size = changes[STORAGE_KEY_CONTEXT_HISTORY_SIZE].newValue;
        subtitleHistory = createSubtitleHistory(typeof size === "number" ? size : DEFAULT_CONTEXT_HISTORY_SIZE);
    }
});

// Pause-on-translate toggle: cached locally so click handlers can read it synchronously.
let pauseOnTranslate = DEFAULT_PAUSE_ON_TRANSLATE;
browser.storage.local.get(STORAGE_KEY_PAUSE_ON_TRANSLATE).then(data => {
    if (typeof data[STORAGE_KEY_PAUSE_ON_TRANSLATE] === "boolean") {
        pauseOnTranslate = data[STORAGE_KEY_PAUSE_ON_TRANSLATE];
    }
});
browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY_PAUSE_ON_TRANSLATE]) {
        const v = changes[STORAGE_KEY_PAUSE_ON_TRANSLATE].newValue;
        pauseOnTranslate = typeof v === "boolean" ? v : DEFAULT_PAUSE_ON_TRANSLATE;
    }
});
// Stores { el, savedNodes } for each segment that was modified by highlighting,
// so restoreHighlights() can put the original DOM back.
let lastHighlightedSegments = [];

// Find subtitle element at click coordinates — needed when an overlay sits on top of subtitles.
// Our own tooltip and context menu are excluded so their mousedown handlers aren't blocked
// by suppressEvents (otherwise elementsFromPoint would "see through" them to subtitles below).
function findSubtitleAt(event) {
    if (event.target?.closest?.("#subtitle-translate-tooltip")) return null;
    if (event.target?.closest?.("#subtitle-translate-context-menu")) return null;
    const direct = event.target.closest(SUBTITLE_SELECTOR);
    if (direct) return direct;
    // Look through all elements stacked at this point (handles overlays)
    for (const el of document.elementsFromPoint(event.clientX, event.clientY)) {
        const match = el.closest(SUBTITLE_SELECTOR);
        if (match) return match;
    }
    return null;
}

// Wait for subtitle DOM to settle after an action (e.g. pause) that may trigger a site re-render.
// Resolves immediately if no mutation occurs within SUBTITLE_SETTLE_TIMEOUT_MS, or after the first mutation settles.
function waitForSubtitleSettle() {
    return new Promise(resolve => {
        const container = document.querySelector(SUBTITLE_SELECTOR)?.parentElement;
        if (!container) { resolve(); return; }
        let timer = setTimeout(done, SUBTITLE_SETTLE_TIMEOUT_MS);
        const observer = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(done, SUBTITLE_SETTLE_DEBOUNCE_MS);
        });
        observer.observe(container, { childList: true, subtree: true, characterData: true });
        function done() { observer.disconnect(); resolve(); }
    });
}

// Cross-browser caret-from-point lookup.
// Firefox has had `caretPositionFromPoint` for years; Chrome only added it in v128
// (Aug 2024) and its behavior has been inconsistent. `caretRangeFromPoint` is the
// older Chrome-native API and is more reliable there. We try the standard API first,
// fall back to the WebKit/Blink one, and normalize both to { offsetNode, offset }.
function getCaretPosition(x, y) {
    if (typeof document.caretPositionFromPoint === "function") {
        const pos = document.caretPositionFromPoint(x, y);
        if (pos?.offsetNode) return { offsetNode: pos.offsetNode, offset: pos.offset };
    }
    if (typeof document.caretRangeFromPoint === "function") {
        const range = document.caretRangeFromPoint(x, y);
        if (range?.startContainer) return { offsetNode: range.startContainer, offset: range.startOffset };
    }
    return null;
}

// Get caret position within a subtitle element, temporarily hiding any overlay elements on top.
// If an overlay element (e.g. YouTube's transparent click-capture div) sits above the subtitle,
// the browser returns the overlay's node instead. We fix this by iterating elementsFromPoint
// (which returns elements top-to-bottom in stacking order), hiding each one until we reach
// the subtitle element, then re-querying so the caret API "sees through" to the subtitle text.
function caretInSubtitle(x, y, subtitleEl) {
    const direct = getCaretPosition(x, y);
    if (direct?.offsetNode && subtitleEl.contains(direct.offsetNode)) return direct;
    const hidden = [];
    for (const el of document.elementsFromPoint(x, y)) {
        if (el === subtitleEl || subtitleEl.contains(el)) break;
        el.style.visibility = "hidden";
        hidden.push(el);
    }
    const caret = getCaretPosition(x, y);
    for (const el of hidden) el.style.visibility = "";
    return caret;
}

// For sites with suppressEvents, trigger subtitle translation on mousedown rather than click.
// Some players (e.g. svt.se portrait videos) attach a document-level capture click handler
// that calls stopImmediatePropagation, so our click listener never fires for subtitle elements
// inside the player container. mousedown is not intercepted this way.
// The flag prevents the click handler below from double-triggering on sites where the click
// event does reach our handler (e.g. svt.se landscape, where our overlay is outside the
// player's click-interception area).
let suppressNextSubtitleClick = false;

if (siteConfig.suppressEvents) {
    document.addEventListener("mousedown", (event) => {
        const subtitle = findSubtitleAt(event);
        if (!subtitle) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.button === 0 && event.detail === 1) {
            suppressNextSubtitleClick = true;
            const caret = caretInSubtitle(event.clientX, event.clientY, subtitle);
            handleClick(caret, event.clientX, event.clientY, subtitle);
        }
    }, true);
    document.addEventListener("pointerdown", (event) => {
        if (findSubtitleAt(event)) {
            event.preventDefault();
            event.stopPropagation();
        }
    }, true);
}

// Click-outside cleanup: dismiss tooltip, restore highlights, and resume video
// when the user clicks anywhere that isn't a subtitle element or the tooltip.
document.addEventListener("click", (event) => {
    if (!lastTooltip) return;
    const isTooltip = lastTooltip.contains(event.target);
    const isContextMenu = document.getElementById("subtitle-translate-context-menu")?.contains(event.target);
    const isSubtitle = !!findSubtitleAt(event);
    if (!isTooltip && !isContextMenu && !isSubtitle) {
        cleanup();
        siteConfig.resumeVideo();
    }
}, true);

// Get the text content of a subtitle segment, joining child nodes with spaces so that
// multi-line cues (e.g. SVT Play spans one <span> per line) don't merge words at line breaks.
// Delegates to joinSubtitleParts to collapse line-break hyphens (e.g. "komplett-" + "eringar").
function segmentText(segment) {
    return joinSubtitleParts(Array.from(segment.childNodes).map(n => n.textContent));
}

// Return the subtitle segments that belong to the same rendering path as captionElement.
// SUBTITLE_SELECTOR is a union across all rendering paths (e.g. on svt.se portrait, the
// TextTrack overlay, the data-rt container, and the VideoPlayerSubtitles__text element all
// appear in the DOM simultaneously). Filtering by parentElement constrains queries to a single
// path so that globalOffset arithmetic and sentence highlighting don't accidentally operate on
// elements from a different path.
// Falls back to all matching segments if captionElement is detached (no parentElement).
function segmentsForCaption(captionElement) {
    const all = Array.from(document.querySelectorAll(SUBTITLE_SELECTOR));
    const captionParent = captionElement.parentElement;
    if (!captionParent) return all;
    return all.filter(seg =>
        seg.parentElement === captionParent ||
        captionElement.contains(seg) ||
        seg.contains(captionElement)
    );
}

// Concatenate all visible subtitle segments into a single string.
function getAllSubtitleText(segments = Array.from(document.querySelectorAll(SUBTITLE_SELECTOR))) {
    return segments.map(segmentText).join(" ").trim();
}

// Poll for subtitle changes and record them in the ring buffer.
// MutationObserver is unreliable here because video players frequently tear down and
// recreate the entire subtitle DOM subtree, detaching the observed container.
let lastSubtitleText = "";
setInterval(() => {
    const text = getAllSubtitleText();
    if (text && text !== lastSubtitleText) {
        lastSubtitleText = text;
        recordSubtitle(text);
    }
}, SUBTITLE_POLL_INTERVAL_MS);

// Single-click on a subtitle word: translate just that word.
// For suppressEvents sites this is handled in the mousedown listener above; the flag
// prevents double-triggering on sites where the click also reaches this handler.
// On double-click, the browser fires a second click with detail=2 before dblclick —
// we skip that so only the dblclick handler runs.
document.addEventListener("click", (event) => {
    const clickedElement = findSubtitleAt(event);
    if (!clickedElement) return;

    event.preventDefault();
    event.stopPropagation();

    // Skip the second click of a double-click; dblclick handler takes over.
    if (event.detail > 1) return;

    // Already handled by mousedown on suppressEvents sites.
    if (suppressNextSubtitleClick) { suppressNextSubtitleClick = false; return; }

    const caret = caretInSubtitle(event.clientX, event.clientY, clickedElement);
    handleClick(caret, event.clientX, event.clientY, clickedElement);
}, true);

// Maps DeepL source-language codes to the English language name used as a
// section heading on en.wiktionary.org (e.g. "SV" -> "Swedish", which becomes
// the "#Swedish" anchor in https://en.wiktionary.org/wiki/god#Swedish).
const DEEPL_TO_WIKTIONARY_LANG = {
    BG: "Bulgarian", ZH: "Chinese", CS: "Czech", DA: "Danish", NL: "Dutch",
    EN: "English", ET: "Estonian", FI: "Finnish", FR: "French", DE: "German",
    EL: "Greek", HU: "Hungarian", ID: "Indonesian", IT: "Italian", JA: "Japanese",
    KO: "Korean", LV: "Latvian", LT: "Lithuanian", NB: "Norwegian Bokmål",
    PL: "Polish", PT: "Portuguese", RO: "Romanian", RU: "Russian", SK: "Slovak",
    SL: "Slovene", ES: "Spanish", SV: "Swedish", TR: "Turkish", UK: "Ukrainian",
};

function openWiktionary(word) {
    browser.storage.local.get(STORAGE_KEY_SOURCE_LANG).then(data => {
        const langName = DEEPL_TO_WIKTIONARY_LANG[data[STORAGE_KEY_SOURCE_LANG]];
        const hash = langName ? `#${encodeURIComponent(langName.replace(/ /g, "_"))}` : "";
        window.open(`https://en.wiktionary.org/wiki/${encodeURIComponent(word)}${hash}`, "_blank");
    });
}

// Right-click on a subtitle: show a context menu with "Copy" (the right-clicked word),
// "Copy sentence" (the sentence containing that word), and "Look up on Wiktionary"
// (opens the Wiktionary entry for the word, jumping to the source-language section).
// Does not pause the video; the word and sentence are captured synchronously so the
// copy still works even if the subtitle changes before the user picks a menu item.
document.addEventListener("contextmenu", (event) => {
    const subtitleElement = findSubtitleAt(event);
    if (!subtitleElement) return;

    const caret = caretInSubtitle(event.clientX, event.clientY, subtitleElement);
    if (!caret?.offsetNode?.textContent) return;

    const text = caret.offsetNode.textContent;
    const caretWord = extractWordAtOffset(text, caret.offset);
    if (!caretWord) return;

    event.preventDefault();
    event.stopPropagation();

    const { word } = joinHyphenatedWord(caretWord.word, text, caretWord.end, subtitleElement);
    const joinedText = Array.from(document.querySelectorAll(SUBTITLE_SELECTOR)).map(s => s.textContent).join(" ");
    const sentence = getFullSentenceFromSubtitles(joinedText, word) || subtitleElement.textContent.trim();

    showContextMenu(event.clientX, event.clientY, [
        { label: "Copy", onSelect: () => navigator.clipboard.writeText(word) },
        { label: "Copy sentence", onSelect: () => navigator.clipboard.writeText(sentence) },
        { label: "Look up on Wiktionary", onSelect: () => openWiktionary(word) },
    ]);
}, true);

// Double-click on a subtitle: translate the sentence containing the clicked word.
// The currentTranslationId bump discards any in-flight single-click translation.
document.addEventListener("dblclick", (event) => {
    const clickedElement = findSubtitleAt(event);
    if (!clickedElement) return;

    event.preventDefault();
    event.stopPropagation();

    const caret = caretInSubtitle(event.clientX, event.clientY, clickedElement);
    handleDoubleClick(event, clickedElement, caret);
}, true);

// Handle a single-click on a subtitle word:
// 1. Extract the clicked word from the caret position using Unicode-aware word boundaries
// 2. Join hyphenated words that are split across subtitle lines (e.g. "komplett-" + "eringar")
// 3. Compute global offset so we can re-find the word after the DOM re-renders on pause
// 4. Pause video, wait for subtitle DOM to settle, highlight the word, translate via DeepL
async function handleClick(caret, clientX, clientY, captionElement) {
    const translationId = ++currentTranslationId;

    if (!caret?.offsetNode?.textContent) return;

    const text = caret.offsetNode.textContent;
    let offset = caret.offset;

    const caretWord = extractWordAtOffset(text, offset);
    if (!caretWord) return;
    let { word: clickedWord, start, end } = caretWord;

    const hyphenResult = joinHyphenatedWord(clickedWord, text, end, captionElement);
    clickedWord = hyphenResult.word;
    // For highlighting: use the original hyphenated form (e.g. "komplett-eringar") so the
    // highlight spans match the actual DOM text; use the joined form for translation.
    const highlightWord = hyphenResult.originalForm || clickedWord;

    // Capture the word's absolute position across all visible segments *before* pausing,
    // because pausing may cause the site to re-render subtitles (new DOM nodes).
    // segmentsForCaption constrains to the same rendering path as the clicked element —
    // see its docstring for why this matters on sites with multiple simultaneous paths.
    const preSegments = segmentsForCaption(captionElement);
    const globalOffset = getGlobalTextOffset(preSegments, captionElement, caret.offsetNode, start, document);

    // Capture subtitle bounding rect *before* pausing. Some sites clear or hide subtitle
    // elements after the video pauses (see "Staleness & DOM Re-render Handling" in CLAUDE.md),
    // which causes post-pause getBoundingClientRect() to return all-zero dimensions.
    const subtitleRect = captionElement.getBoundingClientRect();

    if (pauseOnTranslate) {
        siteConfig.pauseVideo();
        siteConfig.onResume(() => cleanup());
    }

    cleanup();

    if (pauseOnTranslate) {
        await waitForSubtitleSettle();
        if (translationId !== currentTranslationId) return;
    }

    // After pause + settle, subtitle DOM may be entirely new nodes. Re-query and use
    // the saved globalOffset to find and highlight the correct word occurrence.
    // (When not pausing, we're using the original nodes, but re-querying is still safe.)
    const segments = segmentsForCaption(captionElement);
    const highlighted = highlightWordAcrossSegments(segments, highlightWord, globalOffset, document);
    if (highlighted) lastHighlightedSegments = highlighted;

    // Record the hyphen-collapsed form for DeepL context (reads more naturally).
    recordSubtitle(getAllSubtitleText(segments));
    const wordResult = await browser.runtime.sendMessage({ action: "translate", text: clickedWord, context: getSubtitleContext() });
    if (translationId !== currentTranslationId) return;
    showTooltip({
        wordTranslation: wordResult.translation,
        detectedSourceLang: wordResult.detectedSourceLang || null,
        x: clientX,
        y: clientY,
        subtitleRect,
    });
}

async function handleDoubleClick(event, captionElement, caret) {
    const translationId = ++currentTranslationId;
    // Extract the clicked word from the caret to find just the sentence it belongs to,
    // rather than using the full caption element text (which could span multiple sentences).
    const caretWord = caret?.offsetNode?.textContent ? extractWordAtOffset(caret.offsetNode.textContent, caret.offset) : null;
    const clickedWord = caretWord?.word || captionElement.textContent.trim();

    // Capture subtitle bounding rect *before* pausing (same reason as in handleClick).
    const subtitleRect = captionElement.getBoundingClientRect();

    if (pauseOnTranslate) {
        siteConfig.pauseVideo();
        siteConfig.onResume(() => cleanup());
    }

    cleanup();

    if (pauseOnTranslate) {
        await waitForSubtitleSettle();
        if (translationId !== currentTranslationId) return;
    }

    // After pause + settle, subtitle DOM may be entirely new nodes. Re-query.
    // segmentsForCaption constrains to the same rendering path as the clicked element
    // (see its docstring for why this matters on sites with multiple simultaneous paths).
    const allSegments = segmentsForCaption(captionElement);
    // Use raw textContent so sentence substrings match the DOM for highlighting.
    const joinedText = allSegments.map(s => s.textContent).join(" ");
    const sentenceText = getFullSentenceFromSubtitles(joinedText, clickedWord) || captionElement.textContent.trim();
    lastHighlightedSegments = highlightSentenceAcrossSegments(allSegments, sentenceText, document);

    // Fetch context *before* recording so the sentence being translated is not included
    // in its own context (unlike word translation, where including the surrounding
    // sentence helps DeepL disambiguate).
    const sentenceContext = getSubtitleContext();
    recordSubtitle(getAllSubtitleText(allSegments));
    const sentenceResult = await browser.runtime.sendMessage({ action: "translate", text: sentenceText, context: sentenceContext });
    showTooltip({
        wordTranslation: sentenceResult.translation,
        detectedSourceLang: sentenceResult.detectedSourceLang || null,
        x: event.clientX,
        y: event.clientY,
        isSentence: true,
        subtitleRect,
    });
}

function cleanup() {
    if (lastTooltip) { lastTooltip.remove(); lastTooltip = null; }
    lastHighlightedSegments = restoreHighlights(lastHighlightedSegments);
}


// Build and display the translation tooltip.
// - Shows the translated word (bold, 22px); clicking it shows its reverse translation.
// - In sentence mode (double-click), each word is clickable for reverse translation.
// - Right-clicking the tooltip shows a custom context menu with "Copy" / "Copy original".
// Creates the tooltip shell (container + translated-word header) and appends it to the
// document. Returns the tooltip element and the subtitle bounding rect (for positioning).
// Starts with opacity:0 and positions in a rAF callback to avoid a flash at wrong position.
function createTooltipShell({ wordTranslation, x, y, subtitleRect }) {
    const tooltip = document.createElement("div");
    tooltip.id = "subtitle-translate-tooltip";

    const translatedWordDiv = document.createElement("div");
    translatedWordDiv.id = "translatedWord";
    Object.assign(translatedWordDiv.style, { fontSize: subtitleFontSize + "px", fontWeight: "bold", cursor: "pointer" });
    translatedWordDiv.textContent = wordTranslation;
    tooltip.appendChild(translatedWordDiv);

    Object.assign(tooltip.style, {
        position: "fixed",
        background: "rgba(0, 0, 0, 0.85)",
        color: "#fff",
        padding: TOOLTIP_PADDING,
        borderRadius: TOOLTIP_BORDER_RADIUS,
        zIndex: TOOLTIP_Z_INDEX,
        maxWidth: TOOLTIP_MAX_WIDTH,
        transform: "translateX(-50%)",
        textAlign: "center",
        fontFamily: "'YouTube Noto', Roboto, Arial, Helvetica, sans-serif",
        opacity: "0",
    });

    (document.fullscreenElement ?? document.body).appendChild(tooltip);
    lastTooltip = tooltip;

    // Position tooltip above the subtitle element (centered horizontally on it).
    // subtitleRect is captured *before* the video is paused — some sites clear or hide the
    // subtitle element on pause, so a post-pause query would return all-zero dimensions.
    // Falls back to click coordinates if the rect is missing or zero-sized.
    requestAnimationFrame(() => {
        const tooltipRect = tooltip.getBoundingClientRect();
        let tooltipTop, tooltipLeft;
        if (subtitleRect && subtitleRect.width > 0) {
            tooltipTop = subtitleRect.top - tooltipRect.height - TOOLTIP_POSITION_OFFSET;
            tooltipLeft = subtitleRect.left + subtitleRect.width / 2;
        } else {
            // Fall back to click coordinates: position tooltip above the click point.
            tooltipTop = y - tooltipRect.height - TOOLTIP_POSITION_OFFSET;
            tooltipLeft = x;
        }
        tooltip.style.top = `${tooltipTop}px`;
        tooltip.style.left = `${tooltipLeft}px`;
        tooltip.style.opacity = "1";
    });

    return { tooltip };
}

// Show a context menu at (x, y) with the given items.
// Each item is { label, onSelect }; onSelect runs then the menu dismisses itself.
// Dismisses on any outside click.
function showContextMenu(x, y, items) {
    document.getElementById("subtitle-translate-context-menu")?.remove();

    const menu = document.createElement("div");
    menu.id = "subtitle-translate-context-menu";
    Object.assign(menu.style, {
        position: "fixed",
        background: "rgba(30, 30, 30, 0.97)",
        color: "#fff",
        borderRadius: CONTEXT_MENU_BORDER_RADIUS,
        padding: CONTEXT_MENU_PADDING,
        zIndex: CONTEXT_MENU_Z_INDEX,
        minWidth: CONTEXT_MENU_MIN_WIDTH,
        boxShadow: CONTEXT_MENU_BOX_SHADOW,
        fontFamily: "'YouTube Noto', Roboto, Arial, Helvetica, sans-serif",
        fontSize: CONTEXT_MENU_FONT_SIZE,
        // Initially off-screen; repositioned in rAF once dimensions are known
        top: "-9999px",
        left: "-9999px",
    });

    const dismissMenu = () => {
        menu.remove();
        document.removeEventListener("click", onClickOutside, true);
    };
    const onClickOutside = (e) => {
        if (!menu.contains(e.target)) dismissMenu();
    };

    for (const { label, onSelect } of items) {
        const item = document.createElement("div");
        item.textContent = label;
        Object.assign(item.style, { padding: CONTEXT_MENU_ITEM_PADDING, cursor: "pointer" });
        item.addEventListener("mouseenter", () => { item.style.background = "rgba(255,255,255,0.15)"; });
        item.addEventListener("mouseleave", () => { item.style.background = ""; });
        item.addEventListener("mousedown", (event) => {
            if (event.button !== 0) return;
            onSelect();
            dismissMenu();
        });
        menu.appendChild(item);
    }

    (document.fullscreenElement ?? document.body).appendChild(menu);

    requestAnimationFrame(() => {
        menu.style.top = `${y - menu.offsetHeight}px`;
        menu.style.left = `${x}px`;
    });

    document.addEventListener("click", onClickOutside, true);
}

// Attaches a custom right-click context menu to the tooltip.
// Word view: only "Copy" (the translated word).
// Sentence view: "Copy" and "Copy sentence" (both copy the translated sentence,
// since the tooltip's content is the sentence).
function attachContextMenu(tooltip, isSentence) {
    tooltip.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const copy = () => navigator.clipboard.writeText(tooltip.textContent);
        const items = [{ label: "Copy", onSelect: copy }];
        if (isSentence) items.push({ label: "Copy sentence", onSelect: copy });

        showContextMenu(event.clientX, event.clientY, items);
    });
}

// Renders the sentence view: each translated word as a clickable span for reverse translation.
function renderSentenceView({ tooltip, subtitleRect, wordTranslation, state }) {
    tooltip.textContent = "";
    const sentenceDiv = document.createElement("div");
    sentenceDiv.id = "translatedSentence";
    Object.assign(sentenceDiv.style, { fontSize: subtitleFontSize + "px", lineHeight: SENTENCE_VIEW_LINE_HEIGHT });
    tooltip.appendChild(sentenceDiv);

    // Render each translated word as a clickable span for reverse-translation lookup
    const words = wordTranslation.split(/\s+/);
    words.forEach((word, i) => {
        if (i > 0) sentenceDiv.appendChild(document.createTextNode(" "));
        const span = document.createElement("span");
        span.className = "translated-word";
        Object.assign(span.style, { cursor: "pointer" });
        span.textContent = word;
        sentenceDiv.appendChild(span);
    });

    // Reposition tooltip upward since sentence text is taller than a single word
    requestAnimationFrame(() => {
        const newRect = tooltip.getBoundingClientRect();
        // Same guard as createTooltipShell: only use subtitle rect if it has non-zero size
        // (a zero rect means the element was hidden/cleared before we could measure it).
        if (subtitleRect && subtitleRect.width > 0) {
            tooltip.style.top = `${subtitleRect.top - newRect.height - 10}px`;
        }
    });

    // Reverse translation: clicking a word highlights it and shows a popup above the tooltip.
    sentenceDiv.querySelectorAll('.translated-word').forEach(span => {
        span.addEventListener('mousedown', async (event) => {
            if (event.button !== 0) return;
            removeReversePopup(tooltip);
            // Highlight the clicked word, clearing any previous highlight
            sentenceDiv.querySelectorAll('.translated-word').forEach(s => s.classList.remove('highlight-reverse'));
            span.classList.add('highlight-reverse');

            const clickedWord = span.textContent.trim().replace(/[.,!?;:]/g, '');
            const reverseTranslation = await browser.runtime.sendMessage({ action: "translate", text: clickedWord, reverse: true, detectedSourceLang: state.detectedSourceLang });

            showReversePopup(tooltip, reverseTranslation.translation);
        });
    });
}

// Removes any existing reverse-translation popup from the tooltip.
function removeReversePopup(tooltip) {
    tooltip.querySelectorAll('.reverse-translation').forEach(el => el.remove());
}

// Shows a reverse-translation popup positioned above the tooltip.
function showReversePopup(tooltip, text) {
    removeReversePopup(tooltip);
    const popup = document.createElement('div');
    popup.className = 'reverse-translation';
    Object.assign(popup.style, {
        position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(0, 0, 0, 0.85)', color: '#fff', padding: REVERSE_POPUP_PADDING,
        borderRadius: '4px', whiteSpace: 'nowrap', fontSize: subtitleFontSize + "px",
        zIndex: 10000, marginBottom: REVERSE_POPUP_MARGIN_BOTTOM
    });
    tooltip.appendChild(popup);
    popup.textContent = text;
}

// Attaches reverse-translation click handler to the translated word element.
// Clicking the word highlights it and shows a popup above the tooltip.
function attachWordReverseTranslation(tooltip, state) {
    const translatedWordElement = tooltip.querySelector("#translatedWord");
    translatedWordElement.style.cursor = "pointer";
    translatedWordElement.addEventListener("mousedown", async (event) => {
        if (event.button !== 0) return;
        removeReversePopup(tooltip);
        translatedWordElement.classList.add('highlight-reverse');

        const word = translatedWordElement.textContent.trim().replace(/[.,!?;:]/g, '');
        const reverseResult = await browser.runtime.sendMessage({ action: "translate", text: word, reverse: true, detectedSourceLang: state.detectedSourceLang });

        showReversePopup(tooltip, reverseResult.translation);
    });
}

function showTooltip({ wordTranslation, detectedSourceLang, x, y, isSentence, subtitleRect }) {
    const state = { detectedSourceLang };
    const { tooltip } = createTooltipShell({ wordTranslation, x, y, subtitleRect });
    attachContextMenu(tooltip, isSentence);

    if (isSentence) {
        renderSentenceView({ tooltip, subtitleRect, wordTranslation, state });
    } else {
        attachWordReverseTranslation(tooltip, state);
    }
}
