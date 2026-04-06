const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { getSegmentOffsets } = require("../src/utils.js");

function segs(...texts) {
    return texts.map(t => ({ textContent: t }));
}

describe("getSegmentOffsets", () => {
    it("single segment — offset is 0", () => {
        assert.deepEqual(getSegmentOffsets(segs("Hello")), [0]);
    });

    it("two segments — second offset = first length + separator", () => {
        // "Hello" = 5 chars, separator = 1 → second starts at 6
        assert.deepEqual(getSegmentOffsets(segs("Hello", "world")), [0, 6]);
    });

    it("three segments — offsets accumulate correctly", () => {
        // "Hi" (2) + 1 = 3; "there" (5) + 1 = 6; total 9
        assert.deepEqual(getSegmentOffsets(segs("Hi", "there", "!")), [0, 3, 9]);
    });

    it("empty segment — contributes only the separator length", () => {
        // "" (0) + 1 = 1
        assert.deepEqual(getSegmentOffsets(segs("", "word")), [0, 1]);
    });

    it("empty input — returns empty array", () => {
        assert.deepEqual(getSegmentOffsets([]), []);
    });
});
