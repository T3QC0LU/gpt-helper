# GPT Helper

> Chrome Extension (Manifest V3) — silky-smooth ChatGPT UX

## Features (v0.1)

| Feature | Details |
|---------|---------|
| **Auto-collapse code blocks** | Folds `<pre>` blocks > 20 lines when AI starts replying |
| **Auto-collapse long messages** | Folds messages > 500 chars with a fade gradient |
| **Smooth animations** | CSS `transition` + `will-change` — GPU-composited, no JS jank |
| **Conversation switch fade** | Soft fade-in when navigating between chats |
| **FAB controls** | Bottom-right ⚡ button → Collapse all / Expand all |
| **Settings popup** | Configure thresholds & toggle animations (synced across devices) |

## Install (development)

1. Clone this repo
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select this folder
5. Open [ChatGPT](https://chat.openai.com) — the ⚡ FAB appears bottom-right

## Project structure

```
gpt-helper/
├── manifest.json   # MV3 config
├── content.js      # Main logic: MutationObserver, collapse, FAB
├── content.css     # All animations & styles
├── popup.html      # Settings UI
├── popup.js        # Settings persistence (chrome.storage.sync)
└── icons/          # Extension icons
```

## Roadmap

- [x] #1 Extension scaffold
- [x] #2 MutationObserver (streaming detection)
- [x] #3 Code block auto-collapse
- [x] #4 Long message auto-collapse
- [x] #5 CSS animations
- [x] #6 FAB button
- [x] #7 Settings persistence
