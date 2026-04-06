const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildTranslateParams } = require("../src/utils.js");

describe("buildTranslateParams", () => {
    it("includes text and target_lang", () => {
        const params = buildTranslateParams("hello", { sourceLang: "EN", targetLang: "SV" });
        assert.deepEqual(params.text, ["hello"]);
        assert.equal(params.target_lang, "SV");
    });

    it("includes source_lang when sourceLang is non-null", () => {
        const params = buildTranslateParams("hello", { sourceLang: "EN", targetLang: "SV" });
        assert.equal(params.source_lang, "EN");
    });

    it("omits source_lang when sourceLang is null (auto-detect)", () => {
        const params = buildTranslateParams("hello", { sourceLang: null, targetLang: "SV" });
        assert.equal(params.source_lang, undefined);
    });

    it("includes context when provided", () => {
        const params = buildTranslateParams("hello", { sourceLang: "EN", targetLang: "SV" }, "hello world");
        assert.equal(params.context, "hello world");
    });

    it("omits context when not provided", () => {
        const params = buildTranslateParams("hello", { sourceLang: "EN", targetLang: "SV" });
        assert.equal(params.context, undefined);
    });
});
