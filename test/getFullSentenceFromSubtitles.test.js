const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { getFullSentenceFromSubtitles } = require("../src/utils.js");

describe("getFullSentenceFromSubtitles", () => {
    // Single sentence
    it("single sentence — returns entire text", () => {
        const result = getFullSentenceFromSubtitles("Hello world", "world");
        assert.equal(result, "Hello world");
    });

    it("single sentence ending with period", () => {
        const result = getFullSentenceFromSubtitles("Hello world.", "world");
        assert.equal(result, "Hello world.");
    });

    // Multiple sentences
    it("multiple sentences — returns sentence containing word", () => {
        const result = getFullSentenceFromSubtitles("Hello world. How are you?", "world");
        assert.equal(result, "Hello world.");
    });

    it("multiple sentences — returns second sentence when word is there", () => {
        const result = getFullSentenceFromSubtitles("Hello world. How are you?", "you");
        assert.equal(result, "How are you?");
    });

    it("exclamation mark as sentence boundary", () => {
        const result = getFullSentenceFromSubtitles("Stop! I can't believe it.", "believe");
        assert.equal(result, "I can't believe it.");
    });

    it("question mark as sentence boundary", () => {
        const result = getFullSentenceFromSubtitles("Are you there? Yes I am.", "there");
        assert.equal(result, "Are you there?");
    });

    // Offset-based disambiguation
    it("word appears twice — offset selects first occurrence", () => {
        // "I saw the cat. The cat ran away."
        //  0123456789012345678901234567890123
        const text = "I saw the cat. The cat ran away.";
        // "cat" first appears at offset 10
        const result = getFullSentenceFromSubtitles(text, "cat", 10);
        assert.equal(result, "I saw the cat.");
    });

    it("word appears twice — offset selects second occurrence", () => {
        const text = "I saw the cat. The cat ran away.";
        // "cat" second appears at offset 19
        const result = getFullSentenceFromSubtitles(text, "cat", 19);
        assert.equal(result, "The cat ran away.");
    });

    it("wordOffset at last character of sentence returns that sentence, not the next", () => {
        // "Hello world." spans offsets 0–11; offset 11 is the '.' — still in sentence 1
        const text = "Hello world. How are you?";
        const result = getFullSentenceFromSubtitles(text, "world", 11);
        assert.equal(result, "Hello world.");
    });

    it("wordOffset at first character of sentence returns that sentence", () => {
        // " How are you?" starts at offset 12; "you" is at offset 17
        const text = "Hello world. How are you?";
        const result = getFullSentenceFromSubtitles(text, "you", 12);
        assert.equal(result, "How are you?");
    });

    // Sentence spanning a segment boundary (segments joined with " ")
    it("sentence spanning segment boundary", () => {
        // Two segments joined: "Han sprang" + " " + "snabbt bort."
        const text = "Han sprang snabbt bort.";
        const result = getFullSentenceFromSubtitles(text, "snabbt");
        assert.equal(result, "Han sprang snabbt bort.");
    });

    // Case-insensitive word search
    it("case-insensitive match", () => {
        const result = getFullSentenceFromSubtitles("Hello world. How are you?", "WORLD");
        assert.equal(result, "Hello world.");
    });

    // Word not found
    it("word not in text — returns null", () => {
        const result = getFullSentenceFromSubtitles("Hello world.", "banana");
        assert.equal(result, null);
    });

    // Trailing quote/bracket after punctuation
    it("sentence ending with punctuation and closing quote", () => {
        const text = 'He said "run!" She obeyed.';
        const result = getFullSentenceFromSubtitles(text, "run");
        assert.equal(result, 'He said "run!"');
    });

    // wordOffset falls through to substring search when offset matches no sentence
    it("invalid wordOffset falls through to substring search", () => {
        const text = "Hello world. How are you?";
        const result = getFullSentenceFromSubtitles(text, "world", 9999);
        assert.equal(result, "Hello world.");
    });
});
