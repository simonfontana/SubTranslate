// Firefox exposes a native Promise-based `browser` API; Chrome uses `chrome`.
const browser = globalThis.browser ?? globalThis.chrome;

// ---------------------------------------------------------------------------
// Adapter selection — each site has its own adapter that observes subtitles,
// hides the site's native rendering, and provides video control.
// The adapter feeds subtitle text to our shared overlay; all feature code
// below operates exclusively on the overlay's DOM.
// ---------------------------------------------------------------------------
const ADAPTERS = {
    "www.youtube.com": createYouTubeAdapter,
    "www.svtplay.se":  createSvtPlayAdapter,
    "www.svt.se":      createSvtSeAdapter,
};

const adapterFactory = ADAPTERS[window.location.hostname];
if (!adapterFactory) throw new Error(`[subtranslate] No adapter for ${window.location.hostname}`);
const adapter = adapterFactory();

// Subtitle selector — always our own overlay elements, same for all sites.
const SUBTITLE_SELECTOR = '.subtranslate-cue';

// ---------------------------------------------------------------------------
// Settings: font size, highlight color, subtitle history, pause-on-translate
// All settings are resolved per-site (site override → global → default).
// ---------------------------------------------------------------------------
const contentSiteId = getSiteIdFromHostname(window.location.hostname);

let subtitleFontSize = DEFAULT_SUBTITLE_FONT_SIZE;
let subtitleOverlay = null;

// Apply the user's highlight color via CSS custom properties on <html>.
// Two variables are set: a solid color and a 40%-alpha variant used by the
// reverse-translation popup and the subtitle cue highlight (see content.css).
function applyHighlightColor(hex) {
    const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex : DEFAULT_HIGHLIGHT_COLOR;
    const r = parseInt(normalized.slice(1, 3), 16);
    const g = parseInt(normalized.slice(3, 5), 16);
    const b = parseInt(normalized.slice(5, 7), 16);
    const root = document.documentElement;
    root.style.setProperty("--subtranslate-highlight", normalized);
    root.style.setProperty("--subtranslate-highlight-soft", `rgba(${r}, ${g}, ${b}, 0.4)`);
}

// Monotonically increasing ID used to discard stale translation responses.
// Each new click/dblclick bumps this; when the async response arrives, it's
// compared against currentTranslationId — if they differ, the result is outdated.
let currentTranslationId = 0;
let lastTooltip = null;

// Ring buffer for subtitle history — used to build DeepL translation context.
// Recreated when the user changes the history size (losing already-captured history,
// which is acceptable — translation context is ephemeral by nature).
let subtitleHistory = createSubtitleHistory(DEFAULT_CONTEXT_HISTORY_SIZE);
const recordSubtitle = (text) => subtitleHistory.record(text);
const getSubtitleContext = () => subtitleHistory.getContext();

// Pause-on-translate toggle: cached locally so click handlers can read it synchronously.
let pauseOnTranslate = DEFAULT_PAUSE_ON_TRANSLATE;

// Load all site-aware settings from storage and apply them.
function applyAllSettings(allData) {
    const fontSize = getEffectiveSetting(allData, contentSiteId, STORAGE_KEY_SUBTITLE_FONT_SIZE, DEFAULT_SUBTITLE_FONT_SIZE);
    subtitleFontSize = fontSize;
    if (subtitleOverlay) subtitleOverlay.setFontSize(subtitleFontSize);
    for (const id of ["translatedWord", "translatedSentence"]) {
        const el = document.getElementById(id);
        if (el) el.style.fontSize = subtitleFontSize + "px";
    }

    applyHighlightColor(getEffectiveSetting(allData, contentSiteId, STORAGE_KEY_HIGHLIGHT_COLOR, DEFAULT_HIGHLIGHT_COLOR));

    const historySize = getEffectiveSetting(allData, contentSiteId, STORAGE_KEY_CONTEXT_HISTORY_SIZE, DEFAULT_CONTEXT_HISTORY_SIZE);
    subtitleHistory = createSubtitleHistory(typeof historySize === "number" ? historySize : DEFAULT_CONTEXT_HISTORY_SIZE);

    const pause = getEffectiveSetting(allData, contentSiteId, STORAGE_KEY_PAUSE_ON_TRANSLATE, DEFAULT_PAUSE_ON_TRANSLATE);
    pauseOnTranslate = typeof pause === "boolean" ? pause : DEFAULT_PAUSE_ON_TRANSLATE;
}

// Initial load
const CONTENT_STORAGE_KEYS = [
    STORAGE_KEY_SUBTITLE_FONT_SIZE,
    STORAGE_KEY_HIGHLIGHT_COLOR,
    STORAGE_KEY_CONTEXT_HISTORY_SIZE,
    STORAGE_KEY_PAUSE_ON_TRANSLATE,
    STORAGE_KEY_SITE_OVERRIDES,
];
browser.storage.local.get(CONTENT_STORAGE_KEYS).then(applyAllSettings);

// Re-apply when any relevant key (including siteOverrides) changes.
browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const relevant = CONTENT_STORAGE_KEYS.some(k => k in changes);
    if (!relevant) return;
    browser.storage.local.get(CONTENT_STORAGE_KEYS).then(applyAllSettings);
});

// Stores { el, savedNodes } for each segment that was modified by highlighting,
// so restoreHighlights() can put the original DOM back.
let lastHighlightedSegments = [];

// ---------------------------------------------------------------------------
// Caret detection — cross-browser caret-from-point lookup.
// Works directly on our overlay elements (no overlay-hiding needed).
// Firefox has had caretPositionFromPoint for years; Chrome only added it in v128
// (Aug 2024). caretRangeFromPoint is the older Chrome/Blink API and more reliable
// there. We try the standard API first, fall back to the Blink one, and normalize
// both to { offsetNode, offset }.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Event handlers — operate on our overlay's .subtranslate-cue elements.
// No findSubtitleAt, no caretInSubtitle, no suppressEvents needed.
// ---------------------------------------------------------------------------

// Single-click on a subtitle word: translate just that word.
document.addEventListener("click", (event) => {
    const cue = event.target.closest(SUBTITLE_SELECTOR);
    if (!cue) return;

    event.preventDefault();
    event.stopPropagation();

    // Skip the second click of a double-click; dblclick handler takes over.
    if (event.detail > 1) return;

    const caret = getCaretPosition(event.clientX, event.clientY);
    handleClick(caret, event.clientX, event.clientY, cue);
}, true);


// Get the text content of a subtitle segment, joining child nodes with spaces so that
// multi-line cues (inner spans) don't merge words at line breaks.
// Delegates to joinSubtitleParts to collapse line-break hyphens (e.g. "komplett-" + "eringar").
function segmentText(segment) {
    return joinSubtitleParts(Array.from(segment.childNodes).map(n => n.textContent));
}

// Concatenate all visible subtitle segments into a single string.
function getAllSubtitleText(segments) {
    return segments.map(segmentText).join(" ").trim();
}

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

// Right-click on a subtitle: show a context menu with "Copy", "Copy sentence",
// and "Look up on Wiktionary". Does not pause the video; the word and sentence
// are captured synchronously so the copy still works even if the subtitle changes
// before the user picks a menu item.
document.addEventListener("contextmenu", (event) => {
    const cue = event.target.closest(SUBTITLE_SELECTOR);
    if (!cue) return;

    const caret = getCaretPosition(event.clientX, event.clientY);
    if (!caret?.offsetNode?.textContent) return;

    const text = caret.offsetNode.textContent;
    const caretWord = extractWordAtOffset(text, caret.offset);
    if (!caretWord) return;

    event.preventDefault();
    event.stopPropagation();

    const { word } = joinHyphenatedWord(caretWord.word, text, caretWord.end, cue);
    const segments = subtitleOverlay ? subtitleOverlay.getSegments() : [];
    const joinedText = segments.map(s => s.textContent).join(" ");
    const sentence = getFullSentenceFromSubtitles(joinedText, word) || cue.textContent.trim();

    showContextMenu(event.clientX, event.clientY, [
        { label: "Copy", onSelect: () => navigator.clipboard.writeText(word) },
        { label: "Copy sentence", onSelect: () => navigator.clipboard.writeText(sentence) },
        { label: "Look up on Wiktionary", onSelect: () => openWiktionary(word) },
    ]);
}, true);

// Double-click on a subtitle: translate the sentence containing the clicked word.
document.addEventListener("dblclick", (event) => {
    const cue = event.target.closest(SUBTITLE_SELECTOR);
    if (!cue) return;

    event.preventDefault();
    event.stopPropagation();

    const caret = getCaretPosition(event.clientX, event.clientY);
    handleDoubleClick(event, cue, caret);
}, true);

// ---------------------------------------------------------------------------
// Translation handlers — simplified: our overlay is frozen during translation,
// so no waitForSubtitleSettle, no re-querying, no pre-capture of subtitleRect.
// ---------------------------------------------------------------------------

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
    const highlightWord = hyphenResult.originalForm || clickedWord;

    // Compute globalOffset BEFORE dismissPrevious — restoreHighlights replaces
    // text nodes with clones, which would detach caret.offsetNode and make the
    // identity check in getGlobalTextOffset fail.
    const segments = subtitleOverlay.getSegments();
    const globalOffset = getGlobalTextOffset(segments, captionElement, caret.offsetNode, start, document);

    // Dismiss previous tooltip/highlights but keep the overlay frozen — unfreeze
    // would re-render and destroy the segment elements themselves.
    dismissPrevious();

    // Highlight and freeze — overlay won't re-render until cleanup() unfreezes it.
    const highlighted = highlightWordAcrossSegments(segments, highlightWord, globalOffset, document);
    if (highlighted) lastHighlightedSegments = highlighted;
    subtitleOverlay.freeze();

    if (pauseOnTranslate) {
        adapter.pauseVideo();
        adapter.onResume(() => cleanup());
    }

    if (translationId !== currentTranslationId) return;

    recordSubtitle(getAllSubtitleText(segments));
    const wordResult = await browser.runtime.sendMessage({ action: "translate", text: clickedWord, context: getSubtitleContext() });
    if (translationId !== currentTranslationId) return;
    showTooltip({
        wordTranslation: wordResult.translation,
        detectedSourceLang: wordResult.detectedSourceLang || null,
        x: clientX,
        y: clientY,
        // Overlay is frozen, so captionElement is still valid for positioning.
        subtitleRect: captionElement.getBoundingClientRect(),
    });
}

async function handleDoubleClick(event, captionElement, caret) {
    const translationId = ++currentTranslationId;
    const caretWord = caret?.offsetNode?.textContent ? extractWordAtOffset(caret.offsetNode.textContent, caret.offset) : null;
    const clickedWord = caretWord?.word || captionElement.textContent.trim();

    // Compute global offset BEFORE dismissPrevious — restoreHighlights replaces
    // text nodes with clones, which would break getGlobalTextOffset's identity check.
    const segmentsForOffset = subtitleOverlay.getSegments();
    const wordOffset = caretWord
        ? getGlobalTextOffset(segmentsForOffset, captionElement, caret.offsetNode, caretWord.start, document)
        : undefined;

    // Dismiss previous tooltip/highlights but keep the overlay frozen — unfreeze
    // would re-render and destroy captionElement/caret references.
    dismissPrevious();

    const segments = subtitleOverlay.getSegments();
    const joinedText = segments.map(s => s.textContent).join(" ");
    const sentenceText = getFullSentenceFromSubtitles(joinedText, clickedWord, wordOffset) || captionElement.textContent.trim();
    lastHighlightedSegments = highlightSentenceAcrossSegments(segments, sentenceText, document);
    subtitleOverlay.freeze();

    if (pauseOnTranslate) {
        adapter.pauseVideo();
        adapter.onResume(() => cleanup());
    }

    if (translationId !== currentTranslationId) return;

    const sentenceContext = getSubtitleContext();
    recordSubtitle(getAllSubtitleText(segments));
    const sentenceResult = await browser.runtime.sendMessage({ action: "translate", text: sentenceText, context: sentenceContext });
    if (translationId !== currentTranslationId) return;
    showTooltip({
        wordTranslation: sentenceResult.translation,
        detectedSourceLang: sentenceResult.detectedSourceLang || null,
        x: event.clientX,
        y: event.clientY,
        isSentence: true,
        subtitleRect: captionElement.getBoundingClientRect(),
    });
}

// Dismiss previous tooltip and highlights without unfreezing the overlay.
// Used at the start of a new click/dblclick so we can keep working with
// the existing DOM nodes (which unfreeze would destroy via re-render).
function dismissPrevious() {
    if (lastTooltip) { lastTooltip.remove(); lastTooltip = null; }
    lastHighlightedSegments = restoreHighlights(lastHighlightedSegments);
}

// Full cleanup: dismiss UI and unfreeze the overlay so it resumes
// accepting cue updates. Used when the interaction is truly over
// (click-outside, video resume).
function cleanup() {
    dismissPrevious();
    if (subtitleOverlay) subtitleOverlay.unfreeze();
}

// ---------------------------------------------------------------------------
// Tooltip UI — createTooltipShell, context menu, reverse translation
// ---------------------------------------------------------------------------

// Creates the tooltip shell (container + translated-word header) and appends it to the
// document. Starts with opacity:0 and positions in a rAF callback to avoid a flash at
// the wrong position.
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

    requestAnimationFrame(() => {
        const tooltipRect = tooltip.getBoundingClientRect();
        let tooltipTop, tooltipLeft;
        if (subtitleRect && subtitleRect.width > 0) {
            tooltipTop = subtitleRect.top - tooltipRect.height - TOOLTIP_POSITION_OFFSET;
            tooltipLeft = subtitleRect.left + subtitleRect.width / 2;
        } else {
            tooltipTop = y - tooltipRect.height - TOOLTIP_POSITION_OFFSET;
            tooltipLeft = x;
        }
        tooltip.style.top = `${tooltipTop}px`;
        tooltip.style.left = `${tooltipLeft}px`;
        tooltip.style.opacity = "1";
    });

    return { tooltip };
}

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
        // mousedown instead of click: some sites have a document-level capture click
        // handler that calls stopPropagation, which would prevent click from reaching
        // menu items. mousedown is not intercepted this way.
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

function renderSentenceView({ tooltip, subtitleRect, wordTranslation, state }) {
    tooltip.textContent = "";
    const sentenceDiv = document.createElement("div");
    sentenceDiv.id = "translatedSentence";
    Object.assign(sentenceDiv.style, { fontSize: subtitleFontSize + "px", lineHeight: SENTENCE_VIEW_LINE_HEIGHT });
    tooltip.appendChild(sentenceDiv);

    const words = wordTranslation.split(/\s+/);
    words.forEach((word, i) => {
        if (i > 0) sentenceDiv.appendChild(document.createTextNode(" "));
        const span = document.createElement("span");
        span.className = "translated-word";
        Object.assign(span.style, { cursor: "pointer" });
        span.textContent = word;
        sentenceDiv.appendChild(span);
    });

    requestAnimationFrame(() => {
        const newRect = tooltip.getBoundingClientRect();
        if (subtitleRect && subtitleRect.width > 0) {
            tooltip.style.top = `${subtitleRect.top - newRect.height - 10}px`;
        }
    });

    sentenceDiv.querySelectorAll('.translated-word').forEach(span => {
        span.addEventListener('mousedown', async (event) => {
            if (event.button !== 0) return;
            removeReversePopup(tooltip);
            sentenceDiv.querySelectorAll('.translated-word').forEach(s => s.classList.remove('highlight-reverse'));
            span.classList.add('highlight-reverse');

            const clickedWord = span.textContent.trim().replace(/[.,!?;:]/g, '');
            const reverseTranslation = await browser.runtime.sendMessage({ action: "translate", text: clickedWord, reverse: true, detectedSourceLang: state.detectedSourceLang });

            showReversePopup(tooltip, reverseTranslation.translation);
        });
    });
}

function removeReversePopup(tooltip) {
    tooltip.querySelectorAll('.reverse-translation').forEach(el => el.remove());
}

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

// ---------------------------------------------------------------------------
// Initialization — create overlay once the video player is ready, wire up
// the adapter to feed subtitle text to the overlay.
// ---------------------------------------------------------------------------
let lastSubtitleText = "";

function init() {
    const anchor = adapter.getOverlayAnchor();
    if (!anchor) return false;

    subtitleOverlay = createSubtitleOverlay(anchor);
    subtitleOverlay.setFontSize(subtitleFontSize);

    adapter.startObserving((cues) => {
        subtitleOverlay.updateCues(cues);
        // Record subtitle text for DeepL translation context.
        const text = cues.join(' ').trim();
        if (text && text !== lastSubtitleText) {
            lastSubtitleText = text;
            recordSubtitle(text);
        }
    });

    return true;
}

const initTimer = setInterval(() => {
    if (init()) clearInterval(initTimer);
}, SUBTITLE_POLL_INTERVAL_MS);
