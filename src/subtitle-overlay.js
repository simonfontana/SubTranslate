// Shared subtitle overlay — renders adapter-provided cue text in our own DOM.
// All feature code (clicks, highlighting, tooltips) operates on these elements,
// making interaction logic identical across sites.

// eslint-disable-next-line no-unused-vars
function createSubtitleOverlay(anchorElement) {
    const overlay = document.createElement('div');
    overlay.className = 'subtranslate-subtitle-overlay';
    anchorElement.appendChild(overlay);

    let frozen = false;
    let lastCues = [];

    function render(cueLines) {
        overlay.innerHTML = '';
        for (const line of cueLines) {
            const span = document.createElement('span');
            span.className = 'subtranslate-cue';
            const parts = line.split('\n');
            if (parts.length === 1) {
                span.textContent = line;
            } else {
                for (const part of parts) {
                    const inner = document.createElement('span');
                    inner.style.display = 'block';
                    inner.textContent = part;
                    span.appendChild(inner);
                }
            }
            overlay.appendChild(span);
        }
    }

    return {
        // Called when the adapter detects a subtitle change.
        // cueLines is an array of strings; each string is one cue.
        // \n within a string = line break within that cue.
        // Empty array = no subtitles visible.
        updateCues(cueLines) {
            lastCues = cueLines;
            if (!frozen) render(cueLines);
        },

        // Freeze during translation — prevents cue updates from disrupting
        // the user's click target, caret position, or highlighting.
        freeze() { frozen = true; },

        // Unfreeze and re-render with the latest cues the adapter sent while frozen.
        unfreeze() { frozen = false; render(lastCues); },

        // Get current subtitle segments for highlighting/offset calculation.
        getSegments() {
            return Array.from(overlay.querySelectorAll('.subtranslate-cue'));
        },

        // Get the overlay element (for tooltip positioning).
        getElement() { return overlay; },

        // Update font size on the overlay container.
        setFontSize(px) { overlay.style.fontSize = px + 'px'; },

        // Update vertical position (percentage from bottom).
        setPosition(percent) { overlay.style.bottom = percent + '%'; },
    };
}
