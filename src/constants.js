// Shared constants for the subtitle translator extension

// Font sizes
const DEFAULT_SUBTITLE_FONT_SIZE = 40;
const CONTEXT_MENU_FONT_SIZE = "14px";

// Highlight color (applied to translated word/sentence and reverse-translation highlights)
const DEFAULT_HIGHLIGHT_COLOR = "#ffff00";

// Tooltip positioning and spacing
const TOOLTIP_POSITION_OFFSET = 10; // Offset from click coordinates and subtitle spacing
const TOOLTIP_PADDING = "10px";
const TOOLTIP_MAX_WIDTH = "600px";
const TOOLTIP_BORDER_RADIUS = "8px";
const TOOLTIP_Z_INDEX = 9999;

// Context menu styling
const CONTEXT_MENU_Z_INDEX = 10001;
const CONTEXT_MENU_PADDING = "4px 0";
const CONTEXT_MENU_ITEM_PADDING = "6px 16px";
const CONTEXT_MENU_BORDER_RADIUS = "6px";
const CONTEXT_MENU_MIN_WIDTH = "120px";
const CONTEXT_MENU_BOX_SHADOW = "0 2px 8px rgba(0,0,0,0.5)";

// Reverse translation popup styling
const REVERSE_POPUP_PADDING = "4px 8px";
const REVERSE_POPUP_MARGIN_BOTTOM = "6px";

// Sentence view styling
const SENTENCE_VIEW_LINE_HEIGHT = "1.4";

// Storage keys
const STORAGE_KEY_SOURCE_LANG = "sourceLang";
const STORAGE_KEY_TARGET_LANG = "targetLang";
const STORAGE_KEY_DEEPL_API_KEY = "deeplApiKey";
const STORAGE_KEY_SUBTITLE_FONT_SIZE = "subtitleFontSize";
const STORAGE_KEY_HIGHLIGHT_COLOR = "highlightColor";

// API configuration
function getDeeplBaseUrl(apiKey) {
    return apiKey && apiKey.endsWith(":fx")
        ? "https://api-free.deepl.com"
        : "https://api.deepl.com";
}

// Timing (in milliseconds)
const SUBTITLE_POLL_INTERVAL_MS = 500;
const SUBTITLE_SETTLE_TIMEOUT_MS = 150;
const SUBTITLE_SETTLE_DEBOUNCE_MS = 50;
