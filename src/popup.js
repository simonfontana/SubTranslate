// Firefox exposes a native Promise-based `browser` API; Chrome uses `chrome`.
const browser = globalThis.browser ?? globalThis.chrome;

// Popup settings UI — lets the user configure source/target language and DeepL API key.
// Settings are persisted in browser.storage.local and read by background.js on each
// translation request.

const sourceSelect = document.getElementById("sourceLang");
const targetSelect = document.getElementById("targetLang");
const apiKeyInput = document.getElementById("apiKey");
const subtitleFontSizeInput = document.getElementById("subtitleFontSize");
const subtitleFontSizeValue = document.getElementById("subtitleFontSizeValue");
const presetSwatches = document.querySelectorAll("#colorSwatches .color-swatch[data-color]");
const customColorPreview = document.getElementById("customColorPreview");
const hueSlider = document.getElementById("hueSlider");
const satSlider = document.getElementById("satSlider");
const lightSlider = document.getElementById("lightSlider");
const contextHistorySizeInput = document.getElementById("contextHistorySize");
const contextHistorySizeValue = document.getElementById("contextHistorySizeValue");
const deeplModelTypeSelect = document.getElementById("deeplModelType");
const pauseOnTranslateCheckbox = document.getElementById("pauseOnTranslate");
const resetAdvancedBtn = document.getElementById("resetAdvanced");
const statusMsg = document.getElementById("statusMsg");

function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
        const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
        return Math.round(255 * c).toString(16).padStart(2, "0");
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToHsl(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
    }
    return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function updateSliderGradients() {
    const h = hueSlider.value;
    const s = satSlider.value;
    const l = lightSlider.value;
    satSlider.style.background = `linear-gradient(to right, hsl(${h}, 0%, ${l}%), hsl(${h}, 100%, ${l}%))`;
    lightSlider.style.background = `linear-gradient(to right, hsl(${h}, ${s}%, 0%), hsl(${h}, ${s}%, 50%), hsl(${h}, ${s}%, 100%))`;
}

// syncSliders=false when called from a slider drag, to avoid round-tripping
// the user's in-progress value through hexToHsl and back.
function renderColor(color, syncSliders = true) {
    const normalized = (color || "").toLowerCase();
    let matched = false;
    presetSwatches.forEach(btn => {
        const isMatch = btn.dataset.color.toLowerCase() === normalized;
        btn.classList.toggle("selected", isMatch);
        if (isMatch) matched = true;
    });
    customColorPreview.classList.toggle("selected", !matched);
    customColorPreview.style.background = normalized;
    if (syncSliders && /^#[0-9a-f]{6}$/i.test(normalized)) {
        const { h, s, l } = hexToHsl(normalized);
        hueSlider.value = h;
        satSlider.value = s;
        lightSlider.value = l;
    }
    updateSliderGradients();
}

function commitColor(color, syncSliders = true) {
    browser.storage.local.set({ [STORAGE_KEY_HIGHLIGHT_COLOR]: color });
    renderColor(color, syncSliders);
}

function renderContextHistorySize(value) {
    contextHistorySizeInput.value = value;
    contextHistorySizeValue.textContent = value === 0 ? "disabled" : value;
}

// Restore previously saved settings into the form fields
function applyAdvancedSettings(data) {
    const size = typeof data[STORAGE_KEY_CONTEXT_HISTORY_SIZE] === "number"
        ? data[STORAGE_KEY_CONTEXT_HISTORY_SIZE]
        : DEFAULT_CONTEXT_HISTORY_SIZE;
    renderContextHistorySize(size);
    deeplModelTypeSelect.value = data[STORAGE_KEY_DEEPL_MODEL_TYPE] || DEFAULT_DEEPL_MODEL_TYPE;
    pauseOnTranslateCheckbox.checked = typeof data[STORAGE_KEY_PAUSE_ON_TRANSLATE] === "boolean"
        ? data[STORAGE_KEY_PAUSE_ON_TRANSLATE]
        : DEFAULT_PAUSE_ON_TRANSLATE;
}

browser.storage.local.get([
    STORAGE_KEY_SOURCE_LANG,
    STORAGE_KEY_TARGET_LANG,
    STORAGE_KEY_DEEPL_API_KEY,
    STORAGE_KEY_SUBTITLE_FONT_SIZE,
    STORAGE_KEY_HIGHLIGHT_COLOR,
    STORAGE_KEY_CONTEXT_HISTORY_SIZE,
    STORAGE_KEY_DEEPL_MODEL_TYPE,
    STORAGE_KEY_PAUSE_ON_TRANSLATE,
]).then(data => {
    if (data[STORAGE_KEY_SOURCE_LANG]) sourceSelect.value = data[STORAGE_KEY_SOURCE_LANG];
    if (data[STORAGE_KEY_TARGET_LANG]) targetSelect.value = data[STORAGE_KEY_TARGET_LANG];
    if (data[STORAGE_KEY_DEEPL_API_KEY]) apiKeyInput.value = data[STORAGE_KEY_DEEPL_API_KEY];
    if (data[STORAGE_KEY_SUBTITLE_FONT_SIZE]) {
        subtitleFontSizeInput.value = data[STORAGE_KEY_SUBTITLE_FONT_SIZE];
        subtitleFontSizeValue.textContent = data[STORAGE_KEY_SUBTITLE_FONT_SIZE];
    }
    renderColor(data[STORAGE_KEY_HIGHLIGHT_COLOR] || DEFAULT_HIGHLIGHT_COLOR);
    applyAdvancedSettings(data);
});

// Auto-save language and font size settings immediately on change
sourceSelect.addEventListener("change", () => {
    browser.storage.local.set({ [STORAGE_KEY_SOURCE_LANG]: sourceSelect.value });
});

targetSelect.addEventListener("change", () => {
    browser.storage.local.set({ [STORAGE_KEY_TARGET_LANG]: targetSelect.value });
});

subtitleFontSizeInput.addEventListener("input", () => {
    const size = parseInt(subtitleFontSizeInput.value, 10) || DEFAULT_SUBTITLE_FONT_SIZE;
    subtitleFontSizeValue.textContent = size;
    browser.storage.local.set({ [STORAGE_KEY_SUBTITLE_FONT_SIZE]: size });
});

contextHistorySizeInput.addEventListener("input", () => {
    const size = parseInt(contextHistorySizeInput.value, 10);
    renderContextHistorySize(size);
    browser.storage.local.set({ [STORAGE_KEY_CONTEXT_HISTORY_SIZE]: size });
});

deeplModelTypeSelect.addEventListener("change", () => {
    browser.storage.local.set({ [STORAGE_KEY_DEEPL_MODEL_TYPE]: deeplModelTypeSelect.value });
});

pauseOnTranslateCheckbox.addEventListener("change", () => {
    browser.storage.local.set({ [STORAGE_KEY_PAUSE_ON_TRANSLATE]: pauseOnTranslateCheckbox.checked });
});

// Reset the Advanced tab to defaults. Other tabs (language, API key, appearance)
// are left alone — resetting the API key would be a user-hostile surprise.
resetAdvancedBtn.addEventListener("click", () => {
    const defaults = {
        [STORAGE_KEY_CONTEXT_HISTORY_SIZE]: DEFAULT_CONTEXT_HISTORY_SIZE,
        [STORAGE_KEY_DEEPL_MODEL_TYPE]: DEFAULT_DEEPL_MODEL_TYPE,
        [STORAGE_KEY_PAUSE_ON_TRANSLATE]: DEFAULT_PAUSE_ON_TRANSLATE,
    };
    browser.storage.local.set(defaults);
    applyAdvancedSettings(defaults);
});

// We avoid <input type="color"> entirely: its OS/browser dialog steals focus,
// which closes the extension popup on Chrome-on-Linux and Firefox before the
// selection can be saved. Presets + in-popup HSL sliders stay inside the popup.
presetSwatches.forEach(btn => {
    btn.addEventListener("click", () => commitColor(btn.dataset.color));
});

function onSliderInput() {
    commitColor(hslToHex(+hueSlider.value, +satSlider.value, +lightSlider.value), false);
}
hueSlider.addEventListener("input", onSliderInput);
satSlider.addEventListener("input", onSliderInput);
lightSlider.addEventListener("input", onSliderInput);

// Show API key as plain text while focused, masked otherwise
apiKeyInput.addEventListener("focus", () => { apiKeyInput.type = "text"; });
apiKeyInput.addEventListener("blur", () => { apiKeyInput.type = "password"; });

// Validate and save API key with debounce after user stops typing
let apiKeyDebounceTimer = null;
apiKeyInput.addEventListener("input", () => {
    clearTimeout(apiKeyDebounceTimer);
    const key = apiKeyInput.value.trim();

    if (!key) {
        statusMsg.textContent = "";
        return;
    }

    statusMsg.textContent = "Validating API key...";
    statusMsg.style.color = "black";

    apiKeyDebounceTimer = setTimeout(async () => {
        const valid = await validateApiKey(key);
        if (!valid) {
            statusMsg.textContent = "Invalid API key.";
            statusMsg.style.color = "red";
            return;
        }
        await browser.storage.local.set({ [STORAGE_KEY_DEEPL_API_KEY]: key });
        statusMsg.textContent = "API key saved.";
        statusMsg.style.color = "green";
        setTimeout(() => { statusMsg.textContent = ""; }, 2000);
    }, 800);
});

// Validate the API key by making a real translation request to DeepL.
// If the key is valid, DeepL returns a translations array; an invalid key
// returns a 403 error and no translations field.
async function validateApiKey(key) {
    const url = `${getDeeplBaseUrl(key)}/v2/translate`;
    const params = new URLSearchParams();
    params.append("text", "test");
    params.append("source_lang", "EN");
    params.append("target_lang", "DE");

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Authorization": `DeepL-Auth-Key ${key}`
            },
            body: params.toString()
        });

        const data = await res.json();
        return Array.isArray(data.translations);
    } catch (err) {
        console.error("Key validation error:", err);
        return false;
    }
}

// Fetch and display DeepL API usage stats
const usageFooter = document.getElementById("usageFooter");

async function fetchUsage() {
    const { [STORAGE_KEY_DEEPL_API_KEY]: apiKey } = await browser.storage.local.get(STORAGE_KEY_DEEPL_API_KEY);
    if (!apiKey) return;

    try {
        const res = await fetch(`${getDeeplBaseUrl(apiKey)}/v2/usage`, {
            headers: { "Authorization": `DeepL-Auth-Key ${apiKey}` }
        });
        const data = await res.json();
        if (data.character_count != null && data.character_limit != null) {
            const used = data.character_count.toLocaleString();
            const total = data.character_limit.toLocaleString();
            const percent = Math.min(100, (data.character_count / data.character_limit) * 100);
            const barFill = document.getElementById("usageBarFill");
            barFill.style.width = `${percent}%`;
            barFill.style.background = percent >= 90 ? "#d93025" : percent >= 75 ? "#f9ab00" : "#1a73e8";
            document.getElementById("usageText").textContent = `${used} / ${total} characters`;
            usageFooter.title = `${percent.toFixed(1)}% used`;
            usageFooter.style.display = "block";
        }
    } catch (err) {
        console.error("Failed to fetch usage:", err);
    }
}

fetchUsage();

// Tab switching
document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    });
});


