const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createSubtitleHistory, joinSubtitleParts } = require("../src/utils.js");

describe("createSubtitleHistory", () => {
    it("returns null when empty", () => {
        const h = createSubtitleHistory(5);
        assert.equal(h.getContext(), null);
    });

    it("returns a single entry", () => {
        const h = createSubtitleHistory(5);
        h.record("hello");
        assert.equal(h.getContext(), "hello");
    });

    it("returns entries in chronological order", () => {
        const h = createSubtitleHistory(5);
        h.record("one");
        h.record("two");
        h.record("three");
        assert.equal(h.getContext(), "one two three");
    });

    it("ignores consecutive duplicates", () => {
        const h = createSubtitleHistory(5);
        h.record("one");
        h.record("one");
        h.record("two");
        assert.equal(h.getContext(), "one two");
    });

    it("allows the same text to appear again after a different entry", () => {
        const h = createSubtitleHistory(5);
        h.record("one");
        h.record("two");
        h.record("one");
        assert.equal(h.getContext(), "one two one");
    });

    it("overwrites oldest entry once full, preserving chronological order", () => {
        const h = createSubtitleHistory(3);
        h.record("a");
        h.record("b");
        h.record("c");
        h.record("d"); // overwrites "a"
        assert.equal(h.getContext(), "b c d");
    });

    it("continues to return correct order across multiple wrap-arounds", () => {
        const h = createSubtitleHistory(3);
        h.record("a");
        h.record("b");
        h.record("c");
        h.record("d");
        h.record("e");
        h.record("f"); // buffer has rotated twice
        assert.equal(h.getContext(), "d e f");
    });

    it("ignores empty string", () => {
        const h = createSubtitleHistory(5);
        h.record("one");
        h.record("");
        assert.equal(h.getContext(), "one");
    });

    it("instances are independent", () => {
        const a = createSubtitleHistory(5);
        const b = createSubtitleHistory(5);
        a.record("only in a");
        assert.equal(a.getContext(), "only in a");
        assert.equal(b.getContext(), null);
    });

    it("returns null regardless of records when size is 0", () => {
        const h = createSubtitleHistory(0);
        h.record("one");
        h.record("two");
        assert.equal(h.getContext(), null);
    });
});

describe("joinSubtitleParts", () => {
    it("joins parts with spaces", () => {
        assert.equal(joinSubtitleParts(["hello", "world"]), "hello world");
    });

    it("returns single part unchanged", () => {
        assert.equal(joinSubtitleParts(["hello"]), "hello");
    });

    it("collapses ASCII hyphen continuation", () => {
        assert.equal(joinSubtitleParts(["komplett-", "eringar och annat"]), "kompletteringar och annat");
    });

    it("collapses U+2010 hyphen continuation", () => {
        assert.equal(joinSubtitleParts(["komplett\u2010", "eringar"]), "kompletteringar");
    });

    it("collapses U+2011 non-breaking hyphen continuation", () => {
        assert.equal(joinSubtitleParts(["komplett\u2011", "eringar"]), "kompletteringar");
    });

    it("preserves mid-word hyphens", () => {
        assert.equal(joinSubtitleParts(["well-known fact"]), "well-known fact");
    });

    it("handles multiple parts with one hyphenated", () => {
        assert.equal(
            joinSubtitleParts(["Det avfärdar", "komplett-", "eringar hittar man"]),
            "Det avfärdar kompletteringar hittar man"
        );
    });

    it("returns empty string for empty array", () => {
        assert.equal(joinSubtitleParts([]), "");
    });

    it("trims and collapses whitespace", () => {
        assert.equal(joinSubtitleParts(["  hello  ", "  world  "]), "hello world");
    });
});
