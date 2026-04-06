const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { extractWordAtOffset } = require("../src/utils.js");

describe("extractWordAtOffset", () => {
    it("word in middle of text", () => {
        const result = extractWordAtOffset("hello world foo", 7);
        assert.deepEqual(result, { word: "world", start: 6, end: 11 });
    });

    it("word at start of string", () => {
        const result = extractWordAtOffset("hello world", 2);
        assert.deepEqual(result, { word: "hello", start: 0, end: 5 });
    });

    it("word at end of string", () => {
        const result = extractWordAtOffset("hello world", 9);
        assert.deepEqual(result, { word: "world", start: 6, end: 11 });
    });

    it("caret at start of a word", () => {
        const result = extractWordAtOffset("hello world", 6);
        assert.deepEqual(result, { word: "world", start: 6, end: 11 });
    });

    it("caret at end of a word (space after)", () => {
        const result = extractWordAtOffset("hello world", 5);
        assert.deepEqual(result, { word: "hello", start: 0, end: 5 });
    });

    it("punctuation adjacent to word is excluded", () => {
        const result = extractWordAtOffset("hello, world!", 2);
        assert.deepEqual(result, { word: "hello", start: 0, end: 5 });
    });

    it("punctuation after word excluded by forward walk", () => {
        const result = extractWordAtOffset("hello.", 2);
        assert.deepEqual(result, { word: "hello", start: 0, end: 5 });
    });

    it("digits within a word", () => {
        const result = extractWordAtOffset("MP3 player", 1);
        assert.deepEqual(result, { word: "MP3", start: 0, end: 3 });
    });

    it("Swedish unicode letters (å, ä, ö)", () => {
        const result = extractWordAtOffset("det är bra", 5);
        assert.deepEqual(result, { word: "är", start: 4, end: 6 });
    });

    it("Swedish word with ä in middle", () => {
        const result = extractWordAtOffset("välkommen hit", 3);
        assert.deepEqual(result, { word: "välkommen", start: 0, end: 9 });
    });

    it("hyphen included in backward walk (first half of hyphenated word)", () => {
        // caret on "komplett" — the trailing hyphen should be included going backward
        // but the word ends before the hyphen going forward (hyphens excluded forward)
        const result = extractWordAtOffset("komplett-eringar", 4);
        assert.deepEqual(result, { word: "komplett", start: 0, end: 8 });
    });

    it("caret on hyphen itself — backward walk captures prefix", () => {
        const result = extractWordAtOffset("komplett-eringar", 8);
        assert.deepEqual(result, { word: "komplett", start: 0, end: 8 });
    });

    it("hyphen included when caret is on continuation after hyphen", () => {
        // caret on "eringar" — backward walk crosses the hyphen into "komplett"
        const result = extractWordAtOffset("komplett-eringar", 12);
        assert.deepEqual(result, { word: "komplett-eringar", start: 0, end: 16 });
    });

    it("no word at offset (whitespace only)", () => {
        const result = extractWordAtOffset("   ", 1);
        assert.equal(result, null);
    });

    it("empty string returns null", () => {
        const result = extractWordAtOffset("", 0);
        assert.equal(result, null);
    });

    it("single word, no spaces", () => {
        const result = extractWordAtOffset("hej", 1);
        assert.deepEqual(result, { word: "hej", start: 0, end: 3 });
    });
});
