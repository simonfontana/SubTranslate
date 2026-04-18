// Firefox exposes a native Promise-based `browser` API; Chrome uses `chrome`.
const browser = globalThis.browser ?? globalThis.chrome;

// Popup settings UI — lets the user configure source/target language and DeepL API key.
// Settings are persisted in browser.storage.local and read by background.js on each
// translation request. Supports per-site overrides via the scope tabs.

const sourceSelect = document.getElementById("sourceLang");
const targetSelect = document.getElementById("targetLang");
const apiKeyInput = document.getElementById("apiKey");
const subtitleFontSizeInput = document.getElementById("subtitleFontSize");
const subtitleFontSizeValue = document.getElementById("subtitleFontSizeValue");
const subtitlePositionInput = document.getElementById("subtitlePosition");
const subtitlePositionValue = document.getElementById("subtitlePositionValue");
const presetSwatches = document.querySelectorAll("#colorSwatches .color-swatch[data-color]");
const customColorPreview = document.getElementById("customColorPreview");
const hueSlider = document.getElementById("hueSlider");
const satSlider = document.getElementById("satSlider");
const lightSlider = document.getElementById("lightSlider");
const contextHistorySizeInput = document.getElementById("contextHistorySize");
const contextHistorySizeValue = document.getElementById("contextHistorySizeValue");
const deeplModelTypeSelect = document.getElementById("deeplModelType");
const pauseOnTranslateCheckbox = document.getElementById("pauseOnTranslate");
const resetGlobalBtn = document.getElementById("resetGlobalBtn");
const resetSiteBtn = document.getElementById("resetSiteBtn");
const statusMsg = document.getElementById("statusMsg");
const scopeTabs = document.getElementById("scopeTabs");

// ---------------------------------------------------------------------------
// Scope management — "global" or a site ID like "youtube"
// ---------------------------------------------------------------------------
let currentScope = "global";
let currentSiteId = null; // set when on a supported site

// Detect the active tab's site and inject the scope tab button if supported.
async function detectCurrentSite() {
    try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs.length === 0 || !tabs[0].url) return;
        const url = new URL(tabs[0].url);
        const info = SITE_INFO[url.hostname];
        if (!info) return;
        currentSiteId = info.id;
        const btn = document.createElement("button");
        btn.className = "scope-btn";
        btn.dataset.scope = info.id;
        btn.textContent = info.label;
        scopeTabs.appendChild(btn);
    } catch (e) {
        // No tabs permission or unsupported page — global-only mode
    }
}

// Switch scope and reload all field values
function setScope(scope) {
    currentScope = scope;
    scopeTabs.querySelectorAll(".scope-btn").forEach(b =>
        b.classList.toggle("active", b.dataset.scope === scope)
    );
    resetGlobalBtn.style.display = scope === "global" ? "block" : "none";
    resetSiteBtn.style.display = scope !== "global" ? "block" : "none";
    loadAllSettings();
}

// Scope tab click handler (delegated)
scopeTabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".scope-btn");
    if (btn) setScope(btn.dataset.scope);
});

// ---------------------------------------------------------------------------
// Storage helpers — read/write respecting the current scope
// ---------------------------------------------------------------------------

// Load all stored data (global + overrides) from storage.
async function loadStorageData() {
    return browser.storage.local.get([
        STORAGE_KEY_SOURCE_LANG,
        STORAGE_KEY_TARGET_LANG,
        STORAGE_KEY_DEEPL_API_KEY,
        STORAGE_KEY_SUBTITLE_FONT_SIZE,
        STORAGE_KEY_SUBTITLE_POSITION,
        STORAGE_KEY_HIGHLIGHT_COLOR,
        STORAGE_KEY_CONTEXT_HISTORY_SIZE,
        STORAGE_KEY_DEEPL_MODEL_TYPE,
        STORAGE_KEY_PAUSE_ON_TRANSLATE,
        STORAGE_KEY_SITE_OVERRIDES,
    ]);
}

// Get the effective value for a key in the current scope.
function effectiveValue(allData, key, defaultValue) {
    return getEffectiveSetting(allData, currentScope === "global" ? null : currentScope, key, defaultValue);
}

// Save a single key=value for the current scope.
async function saveSetting(key, value) {
    if (currentScope === "global") {
        return browser.storage.local.set({ [key]: value });
    }
    const { [STORAGE_KEY_SITE_OVERRIDES]: overrides = {} } = await browser.storage.local.get(STORAGE_KEY_SITE_OVERRIDES);
    const siteConfig = overrides[currentScope] || {};
    siteConfig[key] = value;
    overrides[currentScope] = siteConfig;
    return browser.storage.local.set({ [STORAGE_KEY_SITE_OVERRIDES]: overrides });
}

// ---------------------------------------------------------------------------
// Color helpers (unchanged)
// ---------------------------------------------------------------------------
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
    saveSetting(STORAGE_KEY_HIGHLIGHT_COLOR, color);
    renderColor(color, syncSliders);
}

function renderContextHistorySize(value) {
    contextHistorySizeInput.value = value;
    contextHistorySizeValue.textContent = value === 0 ? "disabled" : value;
}

// ---------------------------------------------------------------------------
// Load all settings into the form for the current scope
// ---------------------------------------------------------------------------
async function loadAllSettings() {
    const data = await loadStorageData();

    sourceSelect.value = effectiveValue(data, STORAGE_KEY_SOURCE_LANG, "auto");
    targetSelect.value = effectiveValue(data, STORAGE_KEY_TARGET_LANG, "EN");
    apiKeyInput.value = effectiveValue(data, STORAGE_KEY_DEEPL_API_KEY, "") || "";

    const fontSize = effectiveValue(data, STORAGE_KEY_SUBTITLE_FONT_SIZE, DEFAULT_SUBTITLE_FONT_SIZE);
    subtitleFontSizeInput.value = fontSize;
    subtitleFontSizeValue.textContent = fontSize;

    const position = effectiveValue(data, STORAGE_KEY_SUBTITLE_POSITION, DEFAULT_SUBTITLE_POSITION);
    subtitlePositionInput.value = position;
    subtitlePositionValue.textContent = position;

    renderColor(effectiveValue(data, STORAGE_KEY_HIGHLIGHT_COLOR, DEFAULT_HIGHLIGHT_COLOR));

    const historySize = effectiveValue(data, STORAGE_KEY_CONTEXT_HISTORY_SIZE, DEFAULT_CONTEXT_HISTORY_SIZE);
    renderContextHistorySize(typeof historySize === "number" ? historySize : DEFAULT_CONTEXT_HISTORY_SIZE);

    deeplModelTypeSelect.value = effectiveValue(data, STORAGE_KEY_DEEPL_MODEL_TYPE, DEFAULT_DEEPL_MODEL_TYPE);

    const pause = effectiveValue(data, STORAGE_KEY_PAUSE_ON_TRANSLATE, DEFAULT_PAUSE_ON_TRANSLATE);
    pauseOnTranslateCheckbox.checked = typeof pause === "boolean" ? pause : DEFAULT_PAUSE_ON_TRANSLATE;
}

// ---------------------------------------------------------------------------
// Event handlers — auto-save on change, respecting current scope
// ---------------------------------------------------------------------------
sourceSelect.addEventListener("change", () => {
    saveSetting(STORAGE_KEY_SOURCE_LANG, sourceSelect.value);
});

targetSelect.addEventListener("change", () => {
    saveSetting(STORAGE_KEY_TARGET_LANG, targetSelect.value);
});

subtitleFontSizeInput.addEventListener("input", () => {
    const size = parseInt(subtitleFontSizeInput.value, 10) || DEFAULT_SUBTITLE_FONT_SIZE;
    subtitleFontSizeValue.textContent = size;
    saveSetting(STORAGE_KEY_SUBTITLE_FONT_SIZE, size);
});

subtitlePositionInput.addEventListener("input", () => {
    const position = parseInt(subtitlePositionInput.value, 10);
    subtitlePositionValue.textContent = position;
    saveSetting(STORAGE_KEY_SUBTITLE_POSITION, position);
});

contextHistorySizeInput.addEventListener("input", () => {
    const size = parseInt(contextHistorySizeInput.value, 10);
    renderContextHistorySize(size);
    saveSetting(STORAGE_KEY_CONTEXT_HISTORY_SIZE, size);
});

deeplModelTypeSelect.addEventListener("change", () => {
    saveSetting(STORAGE_KEY_DEEPL_MODEL_TYPE, deeplModelTypeSelect.value);
});

pauseOnTranslateCheckbox.addEventListener("change", () => {
    saveSetting(STORAGE_KEY_PAUSE_ON_TRANSLATE, pauseOnTranslateCheckbox.checked);
});

// Reset all global settings to their defaults (does not touch API key or site overrides).
resetGlobalBtn.addEventListener("click", async () => {
    await browser.storage.local.set({
        [STORAGE_KEY_SOURCE_LANG]: "auto",
        [STORAGE_KEY_TARGET_LANG]: "EN",
        [STORAGE_KEY_SUBTITLE_FONT_SIZE]: DEFAULT_SUBTITLE_FONT_SIZE,
        [STORAGE_KEY_SUBTITLE_POSITION]: DEFAULT_SUBTITLE_POSITION,
        [STORAGE_KEY_HIGHLIGHT_COLOR]: DEFAULT_HIGHLIGHT_COLOR,
        [STORAGE_KEY_CONTEXT_HISTORY_SIZE]: DEFAULT_CONTEXT_HISTORY_SIZE,
        [STORAGE_KEY_DEEPL_MODEL_TYPE]: DEFAULT_DEEPL_MODEL_TYPE,
        [STORAGE_KEY_PAUSE_ON_TRANSLATE]: DEFAULT_PAUSE_ON_TRANSLATE,
    });
    loadAllSettings();
});

// Reset all site-specific overrides back to global.
resetSiteBtn.addEventListener("click", async () => {
    const { [STORAGE_KEY_SITE_OVERRIDES]: overrides = {} } = await browser.storage.local.get(STORAGE_KEY_SITE_OVERRIDES);
    delete overrides[currentScope];
    await browser.storage.local.set({ [STORAGE_KEY_SITE_OVERRIDES]: overrides });
    loadAllSettings();
});

// Color swatches
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
        await saveSetting(STORAGE_KEY_DEEPL_API_KEY, key);
        statusMsg.textContent = "API key saved.";
        statusMsg.style.color = "green";
        setTimeout(() => { statusMsg.textContent = ""; }, 2000);
    }, 800);
});

// Validate the API key by making a real translation request to DeepL.
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
    const data = await loadStorageData();
    const apiKey = effectiveValue(data, STORAGE_KEY_DEEPL_API_KEY, null);
    if (!apiKey) return;

    try {
        const res = await fetch(`${getDeeplBaseUrl(apiKey)}/v2/usage`, {
            headers: { "Authorization": `DeepL-Auth-Key ${apiKey}` }
        });
        const result = await res.json();
        if (result.character_count != null && result.character_limit != null) {
            const used = result.character_count.toLocaleString();
            const total = result.character_limit.toLocaleString();
            const percent = Math.min(100, (result.character_count / result.character_limit) * 100);
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

// Tab switching (category tabs)
document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    });
});

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------
(async () => {
    await detectCurrentSite();
    await loadAllSettings();
    fetchUsage();
})();
