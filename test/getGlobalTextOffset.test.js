const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { getGlobalTextOffset } = require("../src/utils.js");

function makeDoc() {
    return new JSDOM("").window.document;
}

function makeSeg(doc, text) {
    const el = doc.createElement("div");
    el.textContent = text;
    doc.body.appendChild(el);
    return el;
}

describe("getGlobalTextOffset", () => {
    it("returns charStart for a single segment with one text node", () => {
        const doc = makeDoc();
        const seg = makeSeg(doc, "Hello world");
        const textNode = seg.firstChild;

        const result = getGlobalTextOffset([seg], seg, textNode, 6, doc);

        assert.equal(result, 6);
    });

    it("accounts for separator in multi-segment offset", () => {
        const doc = makeDoc();
        const seg1 = makeSeg(doc, "Hello");
        const seg2 = makeSeg(doc, "world");
        const textNode2 = seg2.firstChild;

        // seg1: 5 chars + 1 separator = offset 6 for start of seg2
        const result = getGlobalTextOffset([seg1, seg2], seg2, textNode2, 0, doc);

        assert.equal(result, 6);
    });

    it("handles offset within second text node of a segment", () => {
        const doc = makeDoc();
        const seg = doc.createElement("div");
        const span1 = doc.createElement("span");
        span1.textContent = "foo ";
        const span2 = doc.createElement("span");
        span2.textContent = "bar baz";
        seg.appendChild(span1);
        seg.appendChild(span2);
        doc.body.appendChild(seg);

        const textNode2 = span2.firstChild; // "bar baz"

        // "foo " is 4 chars, offset 2 in "bar baz" → global = 4 + 2 = 6
        const result = getGlobalTextOffset([seg], seg, textNode2, 2, doc);

        assert.equal(result, 6);
    });

    it("returns 0 when segment not found", () => {
        const doc = makeDoc();
        const seg = makeSeg(doc, "Hello");
        const other = makeSeg(doc, "Other");

        const result = getGlobalTextOffset([seg], other, other.firstChild, 3, doc);

        assert.equal(result, 0);
    });
});
