const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { highlightSentenceAcrossSegments } = require("../src/utils.js");

function makeDoc() {
    return new JSDOM("").window.document;
}

function makeSeg(doc, text) {
    const el = doc.createElement("div");
    el.textContent = text;
    doc.body.appendChild(el);
    return el;
}

describe("highlightSentenceAcrossSegments", () => {
    it("highlights a sentence contained within one segment", () => {
        const doc = makeDoc();
        const seg = makeSeg(doc, "The cat sat on the mat.");

        const result = highlightSentenceAcrossSegments([seg], "cat sat on", doc);

        assert.equal(result.length, 1);
        assert.equal(seg.querySelector(".highlight-translate").textContent, "cat sat on");
    });

    it("highlights a sentence spanning two segments", () => {
        const doc = makeDoc();
        const seg1 = makeSeg(doc, "The cat");
        const seg2 = makeSeg(doc, "sat on the mat.");

        const result = highlightSentenceAcrossSegments([seg1, seg2], "cat sat on", doc);

        assert.equal(result.length, 2);
        assert.equal(seg1.querySelector(".highlight-translate").textContent, "cat");
        assert.equal(seg2.querySelector(".highlight-translate").textContent, "sat on");
    });

    it("matches case-insensitively", () => {
        const doc = makeDoc();
        const seg = makeSeg(doc, "The Cat Sat On The Mat.");

        const result = highlightSentenceAcrossSegments([seg], "the cat sat", doc);

        assert.equal(result.length, 1);
        assert.equal(seg.querySelector(".highlight-translate").textContent, "The Cat Sat");
    });

    it("returns empty array when sentence not found", () => {
        const doc = makeDoc();
        const seg = makeSeg(doc, "Hello world");

        const result = highlightSentenceAcrossSegments([seg], "missing sentence", doc);

        assert.deepEqual(result, []);
        assert.equal(seg.querySelector(".highlight-translate"), null);
    });
});
