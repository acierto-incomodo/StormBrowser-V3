const { app, BrowserWindow, Menu, clipboard, ipcMain, session } = require("electron");
const path = require("path");
const fs = require("fs");
const Store = require("electron-store").default;

const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const store = new Store();
const historyPath = path.join(app.getPath("userData"), "history.json");

function ensureHistoryFile() {
  try {
    if (!fs.existsSync(historyPath)) {
      fs.writeFileSync(historyPath, JSON.stringify([], null, 2), "utf8");
    }
  } catch (err) {
    console.error("Failed to initialize history file:", err);
  }
}

function readHistoryEntries() {
  ensureHistoryFile();
  try {
    const raw = fs.readFileSync(historyPath, "utf8");
    return JSON.parse(raw || "[]");
  } catch (err) {
    console.error("Failed to read history entries:", err);
    return [];
  }
}

function appendHistoryEntry(entry) {
  if (!entry || !entry.url) return;
  const history = readHistoryEntries();
  history.unshift(entry);
  try {
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to write history entries:", err);
  }
}

let autoUpdater;
try {
  autoUpdater = require("electron-updater").autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
} catch (_) {}

let mainWindow;
let splashWindow;
let blocker;

// ─── AdBlocker ────────────────────────────────────────────────────────────────
function getSpellCheckerLanguages(language) {
  if (!language || language === "auto") return [];
  if (language.startsWith("en")) return ["en-US"];
  if (language.startsWith("es")) return ["es-ES"];
  if (language.startsWith("eu")) return ["eu"];
  return [language];
}

function updateSpellCheckerLanguages(sessionInstance, language) {
  if (!sessionInstance || process.platform === "darwin") return;
  const languages = getSpellCheckerLanguages(language);
  if (languages.length > 0) {
    try {
      sessionInstance.setSpellCheckerLanguages(languages);
    } catch (err) {
      console.error("Failed to set spellchecker languages:", err);
    }
  }
}

async function updateAdBlocker() {
  const settings = store.get("settings", { adBlock: true });
  if (settings.adBlock) {
    if (!blocker) {
      // Requiere fetch global (disponible en Node 18+ / Electron reciente)
      blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
    }
    if (session.defaultSession) {
      blocker.enableBlockingInSession(session.defaultSession);
    }
  } else {
    if (blocker && session.defaultSession) {
      blocker.disableBlockingInSession(session.defaultSession);
    }
  }
}

// ─── Splash ───────────────────────────────────────────────────────────────────
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 380,
    height: 280,
    frame: false,
    transparent: true,
    resizable: false,
    center: true,
    skipTaskbar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  splashWindow.loadFile(path.join(__dirname, "renderer/splash.html"));
}

// ─── Main window ──────────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    backgroundColor: "#0f0f13",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: true,
      nodeIntegrationInSubFrames: true,
      contextIsolation: false,
      webviewTag: true,
      sandbox: false,
      spellcheck: true,
    },
    icon: path.join(__dirname, "renderer/assets/img/logo.svg"),
  });

  mainWindow.loadFile(path.join(__dirname, "renderer/index.html"));

  mainWindow.once("ready-to-show", () => {
    // Check splash setting
    const settings = store.get("settings", {
      splash: true,
      restoreTabs: false,
      closeWarn: true,
      language: "auto",
      startMaximized: false,
    });

    if (settings.splash && splashWindow) {
      // Show splash for at least 1.6s
      setTimeout(() => {
        splashWindow?.close();
        splashWindow = null;
        mainWindow.show();
        if (settings.startMaximized) mainWindow.maximize();
        if (app.isPackaged && autoUpdater)
          autoUpdater.checkForUpdatesAndNotify();
      }, 1600);
    } else {
      splashWindow?.close();
      splashWindow = null;
      mainWindow.show();
      if (settings.startMaximized) mainWindow.maximize();
      if (app.isPackaged && autoUpdater) autoUpdater.checkForUpdatesAndNotify();
    }
  });

  // Close warning — handled in renderer, but also catch system close
  mainWindow.on("close", (e) => {
    // renderer sends 'confirm-close' after user confirms, so we just forward
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function showContextMenu(contents, params) {
  const template = [];

  if (params.dictionarySuggestions && params.dictionarySuggestions.length > 0) {
    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
      template.push({
        label: suggestion,
        click: () => contents.replaceMisspelling(suggestion),
      });
    }
    template.push({ type: "separator" });
  }

  if (params.misspelledWord) {
    template.push({
      label: "Add to Dictionary",
      click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
    });
    template.push({ type: "separator" });
  }

  if (params.linkURL) {
    template.push({
      label: "Open Link in New Tab",
      click: () => mainWindow?.webContents.send("context-menu-open-link-new-tab", params.linkURL),
    });
    template.push({
      label: "Copy Link Address",
      click: () => clipboard.writeText(params.linkURL || ""),
    });
  }

  if (params.mediaType === "image" && params.srcURL) {
    template.push({
      label: "Open Image in New Tab",
      click: () => mainWindow?.webContents.send("context-menu-open-link-new-tab", params.srcURL),
    });
    template.push({
      label: "Copy Image Address",
      click: () => clipboard.writeText(params.srcURL || ""),
    });
  }

  if (template.length > 0) {
    template.push({ type: "separator" });
  }

  if (params.isEditable) {
    template.push(
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { type: "separator" },
      { role: "selectAll" },
    );
  } else {
    template.push({ role: "copy" }, { role: "selectAll" });
  }

  template.push({ type: "separator" });
  template.push({
    label: "Inspect Element",
    click: () => contents.inspectElement(params.x, params.y),
  });

  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: BrowserWindow.fromWebContents(contents) || mainWindow });
}

app.on("web-contents-created", (_event, contents) => {
  contents.on("context-menu", (_event, params) => {
    if (contents === splashWindow?.webContents) return;
    showContextMenu(contents, params);
  });
});

// ─── IPC: Window controls ─────────────────────────────────────────────────────
ipcMain.on("window-minimize", () => mainWindow?.minimize());
ipcMain.on("window-maximize", () => {
  mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize();
});
ipcMain.on("window-close", () => mainWindow?.close());
ipcMain.handle("window-is-maximized", () => mainWindow?.isMaximized() ?? false);

// ─── IPC: Settings ────────────────────────────────────────────────────────────
ipcMain.handle("get-settings", () =>
  store.get("settings", {
    splash: true,
    restoreTabs: false,
    closeWarn: true,
    language: "auto",
    startMaximized: false,
    adBlock: true,
    historyNewTab: true,
  }),
);
ipcMain.on("save-settings", (_, settings) => {
  const old = store.get("settings");
  store.set("settings", settings);
  if (old?.adBlock !== settings.adBlock) {
    updateAdBlocker();
  }
  if (old?.language !== settings.language) {
    updateSpellCheckerLanguages(mainWindow?.webContents?.session, settings.language);
  }
});
ipcMain.handle("get-app-locale", () => app.getLocale());

ipcMain.handle("list-locales", () => {
  try {
    const langDir = path.join(__dirname, "renderer/assets/lang/index");
    return fs
      .readdirSync(langDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""));
  } catch (e) {
    return ["en"];
  }
});

// ─── IPC: Saved tabs ─────────────────────────────────────────────────────────
ipcMain.handle("get-saved-tabs", () => store.get("saved-tabs", []));
ipcMain.on("save-tabs", (_, tabs) => store.set("saved-tabs", tabs));
ipcMain.handle("append-history-entry", (_, entry) => {
  appendHistoryEntry(entry);
});
ipcMain.handle("get-history-entries", () => readHistoryEntries());

// ─── IPC: Updater ────────────────────────────────────────────────────────────
if (autoUpdater) {
  autoUpdater.on("update-available", (info) =>
    mainWindow?.webContents.send("update-available", info),
  );
  autoUpdater.on("download-progress", (progress) =>
    mainWindow?.webContents.send("update-progress", progress),
  );
  autoUpdater.on("update-downloaded", (info) =>
    mainWindow?.webContents.send("update-downloaded", info),
  );
}
ipcMain.on("install-update", () => autoUpdater?.quitAndInstall());

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  updateAdBlocker();
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    delete headers["content-security-policy"];
    delete headers["Content-Security-Policy"];
    callback({ responseHeaders: headers });
  });

  const settings = store.get("settings", { splash: true });
  if (settings.splash) createSplash();
  createMainWindow();
  if (mainWindow?.webContents?.session) {
    updateSpellCheckerLanguages(mainWindow.webContents.session, settings.language);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
