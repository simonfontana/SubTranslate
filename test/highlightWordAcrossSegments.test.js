const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { highlightWordAcrossSegments, restoreHighlights } = require("../src/utils.js");

function makeDoc() {
    return new JSDOM("").window.document;
}

function makeSeg(doc, content) {
    const el = doc.createElement("div");
    if (typeof content === "string") {
        el.textContent = content;
    } else {
        // content is an array of { tag, text } for multi-node segments
        for (const { tag, text } of content) {
            const child = doc.createElement(tag);
            child.textContent = text;
            el.appendChild(child);
        }
    }
    doc.body.appendChild(el);
    return el;
}

describe("highlightWordAcrossSegments", () => {
    it("wraps a word in a single segment with highlight span", () => {
        const doc = makeDoc();
        const seg = makeSeg(doc, "Hello world foo");
        const result = highlightWordAcrossSegments([seg], "world", 6, doc);

        assert.notEqual(result, null);
        assert.equal(result.element, seg);
        assert.equal(result.wordOffset, 6);
        const hl = seg.querySelector(".highlight-translate");
        assert.notEqual(hl, null);
        assert.equal(hl.textContent, "world");
    });

    it("wraps a word spanning multiple text nodes (hyphenated across spans)", () => {
        const doc = makeDoc();
        const seg = makeSeg(doc, [
            { tag: "span", text: "komplett-" },
            { tag: "span", text: "eringar allt" },
        ]);

        const result = highlightWordAcrossSegments([seg], "komplett-eringar", 0, doc);

        assert.notEqual(result, null);
        const highlights = seg.querySelectorAll(".highlight-translate");
        assert.equal(highlights.length, 2);
        assert.equal(highlights[0].textContent, "komplett-");
        assert.equal(highlights[1].textContent, "eringar");
    });

    it("uses globalOffset to disambiguate when the same word appears twice", () => {
        const doc = makeDoc();
        const seg1 = makeSeg(doc, "the cat sat");
        const seg2 = makeSeg(doc, "the cat ran");

        // "cat" in seg2: seg1 length (11) + separator (1) + index of "cat" in seg2 (4) = 16
        const result = highlightWordAcrossSegments([seg1, seg2], "cat", 16, doc);

        assert.notEqual(result, null);
        assert.equal(result.element, seg2);
        assert.equal(seg2.querySelector(".highlight-translate").textContent, "cat");
        // seg1 should not have any highlights
        assert.equal(seg1.querySelector(".highlight-translate"), null);
    });

    it("returns null and leaves DOM unchanged when word not found", () => {
        const doc = makeDoc();
        const seg = makeSeg(doc, "Hello world");

        const result = highlightWordAcrossSegments([seg], "missing", 0, doc);

        assert.equal(result, null);
        assert.equal(seg.textContent, "Hello world");
        assert.equal(seg.querySelector(".highlight-translate"), null);
    });

    it("highlights last word on first line when spans have no whitespace between them", () => {
        const doc = makeDoc();
        // SVT Play structure: two <span> lines inside one segment, no whitespace between them.
        // textContent = "...de få" + "pengar..." = "...de fåpengar..."
        const seg = makeSeg(doc, [
            { tag: "span", text: "Det är snällt, men varför ska de få" },
            { tag: "span", text: "pengar via Sida, våra skattepengar?" },
        ]);

        const result = highlightWordAcrossSegments([seg], "få", 33, doc);

        assert.notEqual(result, null);
        const hl = seg.querySelector(".highlight-translate");
        assert.notEqual(hl, null);
        assert.equal(hl.textContent, "få");
    });

    it("highlights first word on second line when spans have no whitespace between them", () => {
        const doc = makeDoc();
        const seg = makeSeg(doc, [
            { tag: "span", text: "Det är snällt, men varför ska de få" },
            { tag: "span", text: "pengar via Sida, våra skattepengar?" },
        ]);

        // "pengar" is at raw offset 35 in the concatenated textContent
        const result = highlightWordAcrossSegments([seg], "pengar", 35, doc);

        assert.notEqual(result, null);
        const hl = seg.querySelector(".highlight-translate");
        assert.notEqual(hl, null);
        assert.equal(hl.textContent, "pengar");
    });

    it("restoreHighlights removes highlight spans and restores original nodes", () => {
        const doc = makeDoc();
        const seg = makeSeg(doc, "Hello world foo");

        const result = highlightWordAcrossSegments([seg], "world", 6, doc);
        assert.notEqual(result, null);
        assert.notEqual(seg.querySelector(".highlight-translate"), null);

        restoreHighlights(result.highlightedSegments);

        assert.equal(seg.textContent, "Hello world foo");
        assert.equal(seg.querySelector(".highlight-translate"), null);
    });

});
