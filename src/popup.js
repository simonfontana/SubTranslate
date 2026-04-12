// Firefox exposes a native Promise-based `browser` API; Chrome uses `chrome`.
const browser = globalThis.browser ?? globalThis.chrome;

// Popup settings UI — lets the user configure source/target language and DeepL API key.
// Settings are persisted in browser.storage.local and read by background.js on each
// translation request.

const sourceSelect = document.getElementById("sourceLang");
const targetSelect = document.getElementById("targetLang");
const apiKeyInput = document.getElementById("apiKey");
const subtitleFontSizeInput = document.getElementById("subtitleFontSize");
const statusMsg = document.getElementById("statusMsg");

// Restore previously saved settings into the form fields
browser.storage.local.get([STORAGE_KEY_SOURCE_LANG, STORAGE_KEY_TARGET_LANG, STORAGE_KEY_DEEPL_API_KEY, STORAGE_KEY_SUBTITLE_FONT_SIZE]).then(data => {
    if (data[STORAGE_KEY_SOURCE_LANG]) sourceSelect.value = data[STORAGE_KEY_SOURCE_LANG];
    if (data[STORAGE_KEY_TARGET_LANG]) targetSelect.value = data[STORAGE_KEY_TARGET_LANG];
    if (data[STORAGE_KEY_DEEPL_API_KEY]) apiKeyInput.value = data[STORAGE_KEY_DEEPL_API_KEY];
    if (data[STORAGE_KEY_SUBTITLE_FONT_SIZE]) subtitleFontSizeInput.value = data[STORAGE_KEY_SUBTITLE_FONT_SIZE];
});

// Auto-save language and font size settings immediately on change
sourceSelect.addEventListener("change", () => {
    browser.storage.local.set({ [STORAGE_KEY_SOURCE_LANG]: sourceSelect.value });
});

targetSelect.addEventListener("change", () => {
    browser.storage.local.set({ [STORAGE_KEY_TARGET_LANG]: targetSelect.value });
});

subtitleFontSizeInput.addEventListener("change", () => {
    browser.storage.local.set({
        [STORAGE_KEY_SUBTITLE_FONT_SIZE]: parseInt(subtitleFontSizeInput.value, 10) || DEFAULT_SUBTITLE_FONT_SIZE
    });
});

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
    const url = "https://api-free.deepl.com/v2/translate";
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
        const res = await fetch("https://api-free.deepl.com/v2/usage", {
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


