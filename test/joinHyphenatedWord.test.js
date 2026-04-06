const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { joinHyphenatedWord } = require("../src/utils.js");

// Helper: build a minimal captionElement stub with the given textContent
function caption(text) {
    return { textContent: text };
}

describe("joinHyphenatedWord", () => {
    it("no hyphen — returns word unchanged with null originalForm", () => {
        const result = joinHyphenatedWord("hello", "hello world", 5, caption("hello world"));
        assert.deepEqual(result, { word: "hello", originalForm: null });
    });

    it("word at end of text with no hyphen following", () => {
        const result = joinHyphenatedWord("world", "hello world", 11, caption("hello world"));
        assert.deepEqual(result, { word: "world", originalForm: null });
    });

    it("word appears multiple times — first half clicked matches hyphenated occurrence", () => {
        // "foo" appears twice; clicking the first "foo" (followed by hyphen) should join
        const result = joinHyphenatedWord("foo", "foo-", 3, caption("foo-bar and foo"));
        assert.deepEqual(result, { word: "foobar", originalForm: "foo-bar" });
    });

    it("hyphen present in caretText but no continuation match in fullText — returns plain word", () => {
        // caretText ends with hyphen but fullText doesn't have the "word-continuation" pattern
        const result = joinHyphenatedWord("foo", "foo-", 3, caption("something else entirely"));
        assert.deepEqual(result, { word: "foo", originalForm: null });
    });

    describe("case 1 — clicked first half", () => {
        it("ASCII hyphen", () => {
            // caretText is the text node of the first span: "komplett-"
            // endOffset=8 points at '-'
            const result = joinHyphenatedWord("komplett", "komplett-", 8, caption("komplett-eringar och mer"));
            assert.deepEqual(result, { word: "kompletteringar", originalForm: "komplett-eringar" });
        });

        it("U+2010 non-breaking hyphen", () => {
            const text = "komplett\u2010eringar och mer";
            const result = joinHyphenatedWord("komplett", "komplett\u2010", 8, caption(text));
            assert.deepEqual(result, { word: "kompletteringar", originalForm: "komplett\u2010eringar" });
        });

        it("Unicode word (Swedish characters)", () => {
            const result = joinHyphenatedWord("röd", "röd-", 3, caption("röd-grön"));
            assert.deepEqual(result, { word: "rödgrön", originalForm: "röd-grön" });
        });
    });

    describe("case 2 — clicked second half", () => {
        it("ASCII hyphen", () => {
            // caretText is the text node of the second span: "eringar och mer"
            // endOffset=7 (end of "eringar"), no hyphen follows in this text node
            const result = joinHyphenatedWord("eringar", "eringar och mer", 7, caption("komplett-eringar och mer"));
            assert.deepEqual(result, { word: "kompletteringar", originalForm: "komplett-eringar" });
        });

        it("U+2011 non-breaking hyphen", () => {
            const text = "komplett\u2011eringar och mer";
            const result = joinHyphenatedWord("eringar", "eringar och mer", 7, caption(text));
            assert.deepEqual(result, { word: "kompletteringar", originalForm: "komplett\u2011eringar" });
        });
    });
});
