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
};

const siteConfig = SITE_CONFIGS[window.location.hostname];
if (!siteConfig) throw new Error(`[clicksub] No config for ${window.location.hostname}`);
const SUBTITLE_SELECTOR = siteConfig.subtitleSelector;

let subtitleFontSize = DEFAULT_SUBTITLE_FONT_SIZE;
browser.storage.local.get(STORAGE_KEY_SUBTITLE_FONT_SIZE).then(data => {
    if (data[STORAGE_KEY_SUBTITLE_FONT_SIZE]) subtitleFontSize = data[STORAGE_KEY_SUBTITLE_FONT_SIZE];
});
browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY_SUBTITLE_FONT_SIZE]) {
        subtitleFontSize = changes[STORAGE_KEY_SUBTITLE_FONT_SIZE].newValue || DEFAULT_SUBTITLE_FONT_SIZE;
    }
});

// SVT Play (Chrome): the browser renders subtitles via native TextTrack / ::cue
// inside the video element's internal rendering, not as DOM elements we can click.
// Detect this case and create a custom clickable overlay from the TextTrack cue data.
if (window.location.hostname === 'www.svtplay.se') {
    (function initCustomSubtitles() {
        let overlay = null;
        let currentTrack = null;

        function renderCues() {
            if (!overlay || !currentTrack) return;
            overlay.innerHTML = '';
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
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'clicksub-subtitle-container';
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
            if (document.querySelector('.vtt-cue-teletext:not(.clicksub-subtitle-container .vtt-cue-teletext)')) return true;
            const video = document.querySelector('video');
            if (!video) return false;
            for (let i = 0; i < video.textTracks.length; i++) {
                if (video.textTracks[i].mode === 'showing') {
                    setup(video, video.textTracks[i]);
                    return true;
                }
            }
            return false;
        }

        function watchTextTracks(video) {
            if (video._clicksubTrackWatch) return;
            video._clicksubTrackWatch = true;
            video.textTracks.addEventListener('change', () => {
                if (currentTrack && currentTrack.mode === 'disabled') {
                    // User turned off subtitles
                    if (overlay) overlay.innerHTML = '';
                    currentTrack.removeEventListener('cuechange', renderCues);
                    currentTrack = null;
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
const { record: recordSubtitle, getContext: getSubtitleContext } = createSubtitleHistory(5);
// Stores { el, savedNodes } for each segment that was modified by highlighting,
// so restoreHighlights() can put the original DOM back.
let lastHighlightedSegments = [];

// Find subtitle element at click coordinates — needed when an overlay sits on top of subtitles
function findSubtitleAt(event) {
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

// Intercept mousedown/pointerdown in the capture phase on subtitle elements.
// YouTube (and SVT Play) attach their own handlers that would swallow the click
// before our "click" listener fires. By stopping propagation here, we ensure
// the subsequent "click" event reaches our handler below.
if (siteConfig.suppressEvents) {
    for (const eventType of ["mousedown", "pointerdown"]) {
        document.addEventListener(eventType, (event) => {
            if (findSubtitleAt(event)) {
                event.preventDefault();
                event.stopPropagation();
            }
        }, true);
    }
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
// Fires immediately for a responsive feel. On double-click, the browser fires
// a second click with detail=2 before dblclick — we skip that so only the
// dblclick handler runs. The currentTranslationId mechanism discards any
// in-flight word translation if a dblclick supersedes it.
document.addEventListener("click", (event) => {
    const clickedElement = findSubtitleAt(event);
    if (!clickedElement) return;

    event.preventDefault();
    event.stopPropagation();

    // Skip the second click of a double-click; dblclick handler takes over.
    if (event.detail > 1) return;

    const caret = caretInSubtitle(event.clientX, event.clientY, clickedElement);
    handleClick(caret, event.clientX, event.clientY, clickedElement);
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
    const preSegments = Array.from(document.querySelectorAll(SUBTITLE_SELECTOR));
    const globalOffset = getGlobalTextOffset(preSegments, captionElement, caret.offsetNode, start, document);

    siteConfig.pauseVideo();
    siteConfig.onResume(() => cleanup());

    cleanup();

    await waitForSubtitleSettle();
    if (translationId !== currentTranslationId) return;

    // After pause + settle, subtitle DOM may be entirely new nodes. Re-query and use
    // the saved globalOffset to find and highlight the correct word occurrence.
    const segments = Array.from(document.querySelectorAll(SUBTITLE_SELECTOR));
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
        originalText: clickedWord,
    });
}

async function handleDoubleClick(event, captionElement, caret) {
    const translationId = ++currentTranslationId;
    // Extract the clicked word from the caret to find just the sentence it belongs to,
    // rather than using the full caption element text (which could span multiple sentences).
    const caretWord = caret?.offsetNode?.textContent ? extractWordAtOffset(caret.offsetNode.textContent, caret.offset) : null;
    const clickedWord = caretWord?.word || captionElement.textContent.trim();

    siteConfig.pauseVideo();
    siteConfig.onResume(() => cleanup());

    cleanup();

    await waitForSubtitleSettle();
    if (translationId !== currentTranslationId) return;

    // After pause + settle, subtitle DOM may be entirely new nodes. Re-query.
    const allSegments = Array.from(document.querySelectorAll(SUBTITLE_SELECTOR));
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
        originalText: sentenceText,
        isSentence: true,
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
function createTooltipShell({ wordTranslation, x, y }) {
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

    document.body.appendChild(tooltip);
    lastTooltip = tooltip;

    // Position tooltip above the subtitle element (centered horizontally on it).
    // Falls back to click coordinates if no subtitle element is found.
    const subtitleElement = document.querySelector(SUBTITLE_SELECTOR);
    const subtitleRect = subtitleElement ? subtitleElement.getBoundingClientRect() : null;

    requestAnimationFrame(() => {
        const tooltipRect = tooltip.getBoundingClientRect();
        let tooltipTop = y + TOOLTIP_POSITION_OFFSET;
        let tooltipLeft = x + TOOLTIP_POSITION_OFFSET;
        if (subtitleRect) {
            tooltipTop = subtitleRect.top - tooltipRect.height - TOOLTIP_POSITION_OFFSET;
            tooltipLeft = subtitleRect.left + subtitleRect.width / 2;
        }
        tooltip.style.top = `${tooltipTop}px`;
        tooltip.style.left = `${tooltipLeft}px`;
        tooltip.style.opacity = "1";
    });

    return { tooltip, subtitleRect };
}

// Attaches a custom right-click context menu to the tooltip.
// Offers "Copy" (the translation text) and "Copy original" (the source text).
// `state.currentOriginal` is read at click-time so it reflects sentence-expansion updates.
function attachContextMenu(tooltip, state) {
    tooltip.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const existing = document.getElementById("subtitle-translate-context-menu");
        if (existing) existing.remove();

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
        });
        // Initially off-screen; repositioned in rAF once dimensions are known
        menu.style.top = "-9999px";
        menu.style.left = "-9999px";

        const dismissMenu = () => {
            menu.remove();
            document.removeEventListener("click", onClickOutside, true);
        };
        const onClickOutside = (e) => {
            if (!menu.contains(e.target)) dismissMenu();
        };

        const copyItem = document.createElement("div");
        copyItem.textContent = "Copy";
        Object.assign(copyItem.style, { padding: CONTEXT_MENU_ITEM_PADDING, cursor: "pointer" });
        copyItem.addEventListener("mouseenter", () => { copyItem.style.background = "rgba(255,255,255,0.15)"; });
        copyItem.addEventListener("mouseleave", () => { copyItem.style.background = ""; });
        copyItem.addEventListener("click", () => {
            navigator.clipboard.writeText(tooltip.textContent);
            dismissMenu();
        });

        const copyOriginalItem = document.createElement("div");
        copyOriginalItem.textContent = "Copy original";
        Object.assign(copyOriginalItem.style, { padding: CONTEXT_MENU_ITEM_PADDING, cursor: "pointer" });
        copyOriginalItem.addEventListener("mouseenter", () => { copyOriginalItem.style.background = "rgba(255,255,255,0.15)"; });
        copyOriginalItem.addEventListener("mouseleave", () => { copyOriginalItem.style.background = ""; });
        copyOriginalItem.addEventListener("click", () => {
            navigator.clipboard.writeText(state.currentOriginal);
            dismissMenu();
        });

        menu.appendChild(copyItem);
        menu.appendChild(copyOriginalItem);
        document.body.appendChild(menu);

        requestAnimationFrame(() => {
            menu.style.top = `${event.clientY - menu.offsetHeight}px`;
            menu.style.left = `${event.clientX}px`;
        });

        document.addEventListener("click", onClickOutside, true);
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
        if (subtitleRect) {
            tooltip.style.top = `${subtitleRect.top - newRect.height - 10}px`;
        }
    });

    // Reverse translation: clicking a word highlights it and shows a popup above the tooltip.
    sentenceDiv.querySelectorAll('.translated-word').forEach(span => {
        span.addEventListener('click', async () => {
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
        borderRadius: '4px', whiteSpace: 'nowrap', fontSize: REVERSE_POPUP_FONT_SIZE,
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
    translatedWordElement.addEventListener("click", async () => {
        removeReversePopup(tooltip);
        translatedWordElement.classList.add('highlight-reverse');

        const word = translatedWordElement.textContent.trim().replace(/[.,!?;:]/g, '');
        const reverseResult = await browser.runtime.sendMessage({ action: "translate", text: word, reverse: true, detectedSourceLang: state.detectedSourceLang });

        showReversePopup(tooltip, reverseResult.translation);
    });
}

// `state.currentOriginal` tracks what "Copy original" should return.
function showTooltip({ wordTranslation, detectedSourceLang, x, y, originalText, isSentence }) {
    const state = { currentOriginal: originalText, detectedSourceLang };
    const { tooltip, subtitleRect } = createTooltipShell({ wordTranslation, x, y });
    attachContextMenu(tooltip, state);

    if (isSentence) {
        renderSentenceView({ tooltip, subtitleRect, wordTranslation, state });
    } else {
        attachWordReverseTranslation(tooltip, state);
    }
}
