# Storm Browser

A modern, dark browser built with Electron + Chromium.  
Developed by StormGamesStudios.

## Requirements

- Node.js 18+
- npm

## Setup

```bash
npm install
```

## Run in development

```bash
npm start
```

## Build

```bash
# Windows (.exe installer)
npm run build:win

# Linux (.AppImage + .deb)
npm run build:linux

# Both
npm run build:all
```

Output goes to the `dist/` folder.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+T` | New tab |
| `Ctrl+W` | Close tab |
| `Ctrl+L` | Focus URL bar |
| `Ctrl+R` | Reload |
| `Alt+←` | Back |
| `Alt+→` | Forward |
| `Ctrl+1-9` | Switch to tab N |

## Features

- Full Chromium rendering via Electron `<webview>` — loads any website
- Multi-tab with dynamic open/close
- New tab page with search + shortcuts
- URL bar with smart navigation (auto-adds https://, detects searches)
- Lock icon: green = HTTPS, red = HTTP
- Loading spinner + stop button while page loads
- Frameless window with custom title bar
- Keyboard shortcuts
