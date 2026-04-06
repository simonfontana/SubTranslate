const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { resolveLanguages } = require("../src/utils.js");

describe("resolveLanguages", () => {
    it("forward translation with explicit source and target", () => {
        const result = resolveLanguages({ sourceLang: "SV", targetLang: "EN" }, false, null);
        assert.deepEqual(result, { sourceLang: "SV", targetLang: "EN" });
    });

    it("reverse translation swaps source and target", () => {
        const result = resolveLanguages({ sourceLang: "SV", targetLang: "EN" }, true, null);
        assert.deepEqual(result, { sourceLang: "EN", targetLang: "SV" });
    });

    it("auto-detect source with forward translation omits source_lang", () => {
        const result = resolveLanguages({ sourceLang: "auto", targetLang: "EN" }, false, null);
        assert.deepEqual(result, { sourceLang: null, targetLang: "EN" });
    });

    it("auto-detect + reverse uses detectedSourceLang as target", () => {
        const result = resolveLanguages({ sourceLang: "auto", targetLang: "EN" }, true, "SV");
        assert.deepEqual(result, { sourceLang: "EN", targetLang: "SV" });
    });

    it("auto-detect + reverse without detectedSourceLang falls back to SV", () => {
        const result = resolveLanguages({ sourceLang: "auto", targetLang: "EN" }, true, null);
        assert.deepEqual(result, { sourceLang: "EN", targetLang: "SV" });
    });

    it("reverse translation with auto target omits source_lang", () => {
        // targetLang "auto" is unusual but should not be passed to DeepL as source_lang
        const result = resolveLanguages({ sourceLang: "SV", targetLang: "auto" }, true, null);
        assert.deepEqual(result, { sourceLang: null, targetLang: "SV" });
    });

    it("forward translation with missing targetLang falls back to EN", () => {
        const result = resolveLanguages({ sourceLang: "SV" }, false, null);
        assert.deepEqual(result, { sourceLang: "SV", targetLang: "EN" });
    });
});
