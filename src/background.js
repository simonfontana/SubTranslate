// Chrome MV3 runs the background as a service worker (no <script> tags), so utils.js
// must be loaded with importScripts. Firefox loads it via manifest background.scripts.
if (typeof importScripts !== 'undefined') {
    importScripts('constants.js', 'utils.js');
}

// Firefox exposes a native Promise-based `browser` API; Chrome uses `chrome`.
const browser = globalThis.browser ?? globalThis.chrome;

// Message listener for translation requests from content.js.
// `return true` keeps the message channel open for the async sendResponse call —
// without it, the port closes before the fetch completes and the content script
// gets undefined.
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "translate") {
        console.log(`[DEBUG] Received translation request: "${request.text}"`);
        const reverse = request.reverse || false;
        const detectedSourceLang = request.detectedSourceLang || null;
        const context = request.context || null;
        translateWithDeepL(request.text, reverse, detectedSourceLang, context)
            .then(result => {
                console.log(`[DEBUG] Translation successful. Response: "${result.text}"`);
                sendResponse({ translation: result.text, detectedSourceLang: result.detectedSourceLang });
            })
            .catch(error => {
                console.error("[DEBUG] Translation failed:", error);
                sendResponse({ translation: "Translation failed" });
            });
        return true;
    }
});

// Translate text via the DeepL API.
// When `reverse` is true, source and target languages are swapped — this is used
// for the "reverse translation" feature where clicking a word in the translated
// sentence shows its meaning back in the original language.
// When source language is "auto", the source_lang param is omitted entirely so
// DeepL auto-detects it. For reverse translations with auto-detect, `detectedSourceLang`
// (from a prior forward translation's detected_source_language) is used as target_lang.
async function translateWithDeepL(text, reverse = false, detectedSourceLang = null, context = null) {
    const settings = await browser.storage.local.get([
        STORAGE_KEY_SOURCE_LANG,
        STORAGE_KEY_TARGET_LANG,
        STORAGE_KEY_DEEPL_API_KEY,
        STORAGE_KEY_DEEPL_MODEL_TYPE,
    ]);

    const apiKey = settings[STORAGE_KEY_DEEPL_API_KEY];
    if (!apiKey) {
        console.error("[DEBUG] No DeepL API key set");
        return { text: "Please enter your DeepL API key in the extension popup." };
    }

    const { sourceLang, targetLang } = resolveLanguages(settings, reverse, detectedSourceLang);

    const url = `${getDeeplBaseUrl(apiKey)}/v2/translate`;

    const params = buildTranslateParams(text, { sourceLang, targetLang }, context, {
        modelType: settings[STORAGE_KEY_DEEPL_MODEL_TYPE] || DEFAULT_DEEPL_MODEL_TYPE,
    });
    console.log("[DEBUG] DeepL request params:", params);

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `DeepL-Auth-Key ${apiKey}`
            },
            body: JSON.stringify(params),
            mode: "cors"
        });

        const data = await response.json();
        console.log("[DEBUG] DeepL API raw response:", data);

        if (data.translations && data.translations.length > 0) {
            return {
                text: data.translations[0].text,
                detectedSourceLang: data.translations[0].detected_source_language || null
            };
        } else {
            console.error("[DEBUG] DeepL response error:", data);
            return { text: "Translation error" };
        }
    } catch (error) {
        console.error("[DEBUG] DeepL API fetch error:", error);
        return { text: "Translation failed" };
    }
}
