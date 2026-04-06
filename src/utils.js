// Shared pure utility functions used by background.js (and loaded via <script> in the extension).
// Can also be require()'d from Node.js tests.

// NodeFilter.SHOW_TEXT is a browser global; provide a fallback for Node.js tests.
var SHOW_TEXT = typeof NodeFilter !== "undefined" ? NodeFilter.SHOW_TEXT : 4;

// Resolve the source and target languages for a DeepL translation request.
// settings: { sourceLang, targetLang }
// reverse:  true for reverse translation (swap source/target)
// detectedSourceLang: detected_source_language from a prior forward translation,
//   used as target_lang when the configured source is "auto" and reverse is true.
//
// Returns { sourceLang, targetLang } where sourceLang may be null (omit from API call).
function resolveLanguages(settings, reverse, detectedSourceLang) {
    const sourceLang = reverse ? settings.targetLang : settings.sourceLang || "SV";
    // When sourceLang is "auto" and this is a reverse translation, targetLang would be
    // "auto" which DeepL rejects. Fall back to detectedSourceLang from the forward
    // translation, or "SV" as a last resort.
    const rawTargetLang = reverse ? settings.sourceLang : settings.targetLang || "EN";
    const targetLang = (rawTargetLang === "auto" || !rawTargetLang)
        ? (detectedSourceLang || "SV")
        : rawTargetLang;

    return {
        sourceLang: sourceLang === "auto" ? null : sourceLang,
        targetLang,
    };
}

// Join a hyphenated word split across subtitle lines within a caption element.
// e.g. <span>komplett-</span><span>eringar ...</span> → word: "kompletteringar", originalForm: "komplett-eringar"
// Uses captionElement.textContent (which concatenates all inner spans) as the source of truth.
// Returns { word, originalForm } — word is for translation, originalForm is for highlighting.
function joinHyphenatedWord(clickedWord, caretText, endOffset, captionElement) {
    const fullText = captionElement.textContent;
    const hyphenChars = '-\u2010\u2011';

    // Case 1: clicked word is followed by a hyphen in its text node
    if (endOffset < caretText.length && hyphenChars.includes(caretText[endOffset])) {
        // Find "clickedWord-<continuation>" in the full caption text
        const re = new RegExp(clickedWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[' + hyphenChars + '](\\p{L}[\\p{L}\\d]*)', 'u');
        const m = fullText.match(re);
        if (m) return { word: clickedWord + m[1], originalForm: m[0] };
    }

    // Case 2: clicked the continuation — check if full text has "<prefix>-clickedWord"
    const re2 = new RegExp('([\\p{L}\\d]+)[' + hyphenChars + ']' + clickedWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\d])', 'u');
    const m2 = fullText.match(re2);
    if (m2) return { word: m2[1] + clickedWord, originalForm: m2[0] };

    return { word: clickedWord, originalForm: null };
}

// Extract the word at a given offset within text.
// Walks backward (including hyphens, to catch the first half of hyphenated words)
// and forward (excluding hyphens — continuation is handled by joinHyphenatedWord).
// Returns { word, start, end } where start/end are character offsets into text,
// or null if no word characters are adjacent to the offset.
function extractWordAtOffset(text, offset) {
    let start = offset, end = offset;
    while (start > 0 && /\p{L}|\d|-/u.test(text[start - 1])) start--;
    while (end < text.length && /\p{L}|\d/u.test(text[end])) end++;

    const word = text.slice(start, end);
    if (!word) return null;

    return { word, start, end };
}

// Find the sentence within `text` that contains the clicked word.
// text:        pre-joined string from all subtitle segments (separated by " ")
// clickedWord: the word (or phrase) to locate
// wordOffset:  character offset of clickedWord in text — used to pick the right
//              sentence when the same word appears more than once. Omit to fall
//              back to a simple substring search.
// Returns the trimmed sentence string, or null if not found.
function getFullSentenceFromSubtitles(text, clickedWord, wordOffset) {
    const sentenceRegex = /[^.!?]*[.!?]+["')\]]*|[^.!?]+$/g;

    if (wordOffset !== undefined) {
        let match;
        while ((match = sentenceRegex.exec(text))) {
            if (wordOffset >= match.index && wordOffset < match.index + match[0].length) {
                return match[0].trim();
            }
        }
        sentenceRegex.lastIndex = 0;
    }

    const lowerClicked = clickedWord.toLowerCase();
    const sentences = text.match(sentenceRegex) || [];
    for (const sentence of sentences) {
        if (sentence.toLowerCase().includes(lowerClicked)) return sentence.trim();
    }
    return null;
}

// When segments are conceptually joined into one string (for sentence extraction,
// word-offset matching, etc.), we insert a 1-char separator (space) between them.
const SEGMENT_SEPARATOR_LENGTH = 1;

// Build an array of absolute character offsets — one per segment — representing where
// each segment's textContent starts in the virtual concatenated string.
// E.g. segments ["Hello", "world"] → offsets [0, 6] (5 chars + 1 separator).
function getSegmentOffsets(segments) {
    const offsets = [];
    let pos = 0;
    for (const seg of segments) {
        offsets.push(pos);
        pos += seg.textContent.length + SEGMENT_SEPARATOR_LENGTH;
    }
    return offsets;
}

// Compute the absolute character position of `charStart` within `targetNode` across
// all visible subtitle segments. This "global offset" survives DOM re-renders (where
// the actual node references become stale) because it's a numeric position in the
// concatenated text of all segments.
function getGlobalTextOffset(segments, clickedSegment, targetNode, charStart, doc) {
    const segOffsets = getSegmentOffsets(segments);
    for (let i = 0; i < segments.length; i++) {
        if (segments[i] !== clickedSegment) continue;
        const walker = doc.createTreeWalker(segments[i], SHOW_TEXT);
        let nodeOffset = segOffsets[i];
        let node;
        while ((node = walker.nextNode())) {
            if (node === targetNode) return nodeOffset + charStart;
            nodeOffset += node.textContent.length;
        }
        return nodeOffset + charStart;
    }
    return 0;
}

// Apply highlight spans to a character range [rawStart, rawEnd) within a single element.
// Walks all text nodes, uses splitText() to isolate the covered portion of each node,
// and wraps it in a <span class="highlight-translate">. Handles ranges that span
// multiple text nodes (e.g. SVT Play where each subtitle line is a separate <span>).
function highlightRangeInSegment(el, rawStart, rawEnd, doc) {
    const walker = doc.createTreeWalker(el, SHOW_TEXT);
    let offset = 0;
    let node;
    while ((node = walker.nextNode())) {
        const nodeLen = node.textContent.length;
        const nodeStart = offset;
        const nodeEnd = offset + nodeLen;

        const hlStart = Math.max(rawStart, nodeStart);
        const hlEnd = Math.min(rawEnd, nodeEnd);

        if (hlStart < hlEnd) {
            const localStart = hlStart - nodeStart;
            const localEnd = hlEnd - nodeStart;

            const matchNode = node.splitText(localStart);
            const after = matchNode.splitText(localEnd - localStart);

            const highlight = doc.createElement("span");
            highlight.className = "highlight-translate";
            matchNode.parentNode.replaceChild(highlight, matchNode);
            highlight.appendChild(matchNode);

            walker.currentNode = after;
            offset = hlEnd;
            if (offset >= rawEnd) break;
            continue;
        }
        offset = nodeEnd;
    }
}

// Build a searchable text from an element by walking text nodes and inserting
// a space at node boundaries where there's no existing whitespace. This is
// needed because element.textContent concatenates child text nodes directly
// (e.g. <span>få</span><span>pengar</span> → "fåpengar"), which breaks
// word-boundary detection. Returns the padded text and the positions where
// spaces were inserted, so match indices can be mapped back to raw offsets.
function getSearchableText(element, doc) {
    const walker = doc.createTreeWalker(element, SHOW_TEXT);
    let text = "";
    const insertedSpacePositions = [];
    let prevNode = null;
    let node;
    while ((node = walker.nextNode())) {
        if (prevNode) {
            const prevEnd = prevNode.textContent.slice(-1);
            const currStart = node.textContent[0];
            const hyphenChars = "-\u2010\u2011";
            if (prevEnd && !/\s/.test(prevEnd) && !hyphenChars.includes(prevEnd) && currStart && !/\s/.test(currStart)) {
                insertedSpacePositions.push(text.length);
                text += " ";
            }
        }
        text += node.textContent;
        prevNode = node;
    }
    return { text, insertedSpacePositions };
}

function searchableIndexToRaw(index, insertedSpacePositions) {
    let adjustment = 0;
    for (const pos of insertedSpacePositions) {
        if (pos < index) adjustment++;
        else break;
    }
    return index - adjustment;
}

// Find and highlight a word across all subtitle segments, using globalOffset to
// disambiguate when the same word appears multiple times.
// Returns { element, wordOffset, highlightedSegments } or null if not found.
function highlightWordAcrossSegments(segments, clickedWord, globalOffset, doc) {
    const safeWord = clickedWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?<![\\p{L}\\d])${safeWord}(?![\\p{L}\\d])`, "giu");
    const segOffsets = getSegmentOffsets(segments);

    const matches = [];
    for (let i = 0; i < segments.length; i++) {
        const { text, insertedSpacePositions } = getSearchableText(segments[i], doc);
        let m;
        regex.lastIndex = 0;
        while ((m = regex.exec(text))) {
            const rawIndex = searchableIndexToRaw(m.index, insertedSpacePositions);
            matches.push({ segment: segments[i], index: rawIndex, length: m[0].length, absOffset: segOffsets[i] + rawIndex });
        }
    }

    if (matches.length === 0) return null;

    const best = matches.find(m => m.absOffset === globalOffset)
        || matches.reduce((a, b) =>
            Math.abs(a.absOffset - globalOffset) < Math.abs(b.absOffset - globalOffset) ? a : b
        );

    const seg = best.segment;
    const savedNodes = Array.from(seg.childNodes).map(n => n.cloneNode(true));
    highlightRangeInSegment(seg, best.index, best.index + best.length, doc);

    return { element: seg, wordOffset: best.absOffset, highlightedSegments: [{ el: seg, savedNodes }] };
}

// Highlight an entire sentence across multiple subtitle segments.
// Returns an array of { el, savedNodes } for each modified segment.
function highlightSentenceAcrossSegments(segments, sentenceText, doc) {
    let fullText = "";
    const segmentData = [];

    for (let el of segments) {
        const rawText = el.textContent;
        const trimmed = rawText.trim();
        const leadingTrim = rawText.length - rawText.trimStart().length;
        if (fullText) fullText += " ";
        const start = fullText.length;
        fullText += trimmed;
        const end = fullText.length;
        segmentData.push({ el, start, end, savedNodes: Array.from(el.childNodes).map(n => n.cloneNode(true)), leadingTrim });
    }

    const fullLowerText = fullText.toLowerCase();
    const lowerSentence = sentenceText.trim().toLowerCase();
    const sentenceStart = fullLowerText.indexOf(lowerSentence);
    if (sentenceStart === -1) return [];

    const sentenceEnd = sentenceStart + lowerSentence.length;

    const highlightedSegments = [];

    for (const { el, start, end, savedNodes, leadingTrim } of segmentData) {
        const overlapStart = Math.max(start, sentenceStart);
        const overlapEnd = Math.min(end, sentenceEnd);
        if (overlapStart >= overlapEnd) continue;

        const rawStart = (overlapStart - start) + leadingTrim;
        const rawEnd = (overlapEnd - start) + leadingTrim;

        highlightRangeInSegment(el, rawStart, rawEnd, doc);
        highlightedSegments.push({ el, savedNodes });
    }

    return highlightedSegments;
}

// Restore subtitle DOM nodes to their pre-highlight state by replacing the current
// (split + wrapped) children with the saved original childNode clones.
// Returns [] so callers can reset in one step: `segments = restoreHighlights(segments)`.
function restoreHighlights(highlightedSegments) {
    for (const { el, savedNodes } of highlightedSegments) {
        el.textContent = "";
        for (const node of savedNodes) {
            el.appendChild(node);
        }
    }
    return [];
}

// Build a request body object for a DeepL /v2/translate POST request.
// resolvedLangs: { sourceLang, targetLang } as returned by resolveLanguages().
// sourceLang may be null (auto-detect) — in that case source_lang is omitted.
// context (optional): surrounding sentence text sent as DeepL context for better word translation.
function buildTranslateParams(text, resolvedLangs, context = null) {
    // text is wrapped in an array — DeepL's JSON API requires text as an array of strings.
    const params = { text: [text], target_lang: resolvedLangs.targetLang };
    if (resolvedLangs.sourceLang !== null) {
        params.source_lang = resolvedLangs.sourceLang;
    }
    if (context) {
        params.context = context;
    }
    return params;
}

// Factory for a fixed-size ring buffer that records subtitle sentences for use as
// DeepL translation context. Each call returns an independent instance with its own state.
// - record(text): appends text; consecutive duplicates are ignored; O(1)
// - getContext(): returns all entries joined in chronological order, or null if empty; O(size)
function createSubtitleHistory(size) {
    const buffer = new Array(size).fill(null);
    let counter = 0;

    function record(text) {
        if (!text) return;
        const last = counter > 0 ? buffer[(counter - 1) % size] : null;
        if (text === last) return;
        buffer[counter % size] = text;
        counter++;
    }

    function getContext() {
        const filled = Math.min(counter, size);
        if (filled === 0) return null;
        const oldest = counter - filled;
        const parts = [];
        for (let i = 0; i < filled; i++) {
            parts.push(buffer[(oldest + i) % size]);
        }
        return parts.join(" ");
    }

    return { record, getContext };
}

// Join an array of text parts (one per subtitle line/span), collapsing line-break
// hyphens so that "komplett-" + "eringar" → "kompletteringar".
function joinSubtitleParts(parts) {
    const hyphenRe = /[-\u2010\u2011]$/;
    let result = "";
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (i > 0) {
            result += hyphenRe.test(parts[i - 1]) ? "" : " ";
        }
        result += hyphenRe.test(part) ? part.slice(0, -1) : part;
    }
    return result.replace(/\s+/g, " ").trim();
}

if (typeof module !== "undefined") {
    module.exports = { resolveLanguages, joinHyphenatedWord, extractWordAtOffset, getFullSentenceFromSubtitles, getSegmentOffsets, getGlobalTextOffset, getSearchableText, searchableIndexToRaw, highlightRangeInSegment, highlightWordAcrossSegments, highlightSentenceAcrossSegments, restoreHighlights, buildTranslateParams, createSubtitleHistory, joinSubtitleParts };
}
