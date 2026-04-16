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

    it("omits model_type when set to 'latency_optimized' (API default)", () => {
        const params = buildTranslateParams("hello", { sourceLang: "EN", targetLang: "DE" }, null, { modelType: "latency_optimized" });
        assert.equal(params.model_type, undefined);
    });

    it("includes model_type when set to prefer_quality_optimized", () => {
        const params = buildTranslateParams("hello", { sourceLang: "EN", targetLang: "DE" }, null, { modelType: "prefer_quality_optimized" });
        assert.equal(params.model_type, "prefer_quality_optimized");
    });

    it("omits model_type when options is empty", () => {
        const params = buildTranslateParams("hello", { sourceLang: "EN", targetLang: "DE" });
        assert.equal(params.model_type, undefined);
    });
});
