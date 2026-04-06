// Firefox exposes a native Promise-based `browser` API; Chrome uses `chrome`.
const browser = globalThis.browser ?? globalThis.chrome;

// Popup settings UI — lets the user configure source/target language and DeepL API key.
// Settings are persisted in browser.storage.local and read by background.js on each
// translation request.

const sourceSelect = document.getElementById("sourceLang");
const targetSelect = document.getElementById("targetLang");
const apiKeyInput = document.getElementById("apiKey");
const saveBtn = document.getElementById("saveBtn");
const statusMsg = document.getElementById("statusMsg");

// Restore previously saved settings into the form fields
browser.storage.local.get(["sourceLang", "targetLang", "deeplApiKey"]).then(data => {
    if (data.sourceLang) sourceSelect.value = data.sourceLang;
    if (data.targetLang) targetSelect.value = data.targetLang;
    if (data.deeplApiKey) apiKeyInput.value = data.deeplApiKey;
});

// Save on button click
saveBtn.addEventListener("click", async () => {
    const apiKey = apiKeyInput.value.trim();

    if (!apiKey) {
        statusMsg.textContent = "Please enter your API key.";
        statusMsg.style.color = "red";
        return;
    }

    statusMsg.textContent = "Validating API key...";
    statusMsg.style.color = "black";

    console.log("Validating key");
    const valid = await validateApiKey(apiKey);
    if (!valid) {
        statusMsg.textContent = "Invalid API key.";
        statusMsg.style.color = "red";
        return;
    }

    // Save all settings if key is valid
    await browser.storage.local.set({
        sourceLang: sourceSelect.value,
        targetLang: targetSelect.value,
        deeplApiKey: apiKey
    });

    statusMsg.textContent = "Settings saved!";
    statusMsg.style.color = "green";
    setTimeout(() => {
        statusMsg.textContent = "";
    }, 2000);
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

// Close button
const closeBtn = document.getElementById("closeBtn");
closeBtn.addEventListener("click", () => {
    window.close();
});

