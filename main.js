const { app, BrowserWindow, ipcMain, session, shell, Menu, MenuItem } = require("electron");
const path = require("path");
const fs = require("fs");

// electron-updater — only active in packaged builds
let autoUpdater;
try {
  autoUpdater = require("electron-updater").autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = true;
} catch (_) {
  // Not installed or running in dev without it
}

let mainWindow;

// Rutas para archivos externos (editables fuera del asar en producción)
const baseExtraPath = app.isPackaged 
  ? path.join(process.resourcesPath, "extraFiles") 
  : path.join(__dirname, "renderer", "extraFiles");

if (!fs.existsSync(baseExtraPath)) fs.mkdirSync(baseExtraPath, { recursive: true });

const shortcutsPath = path.join(baseExtraPath, "shortcuts.json");
const searchEnginePath = path.join(baseExtraPath, "search-engine.json");
const settingsPath = path.join(baseExtraPath, "settings.json");
const customSearchPath = path.join(baseExtraPath, "custom.search-engine.json");
const iconsDir = path.join(app.getPath("userData"), "icons");

// Asegurar que la carpeta de iconos existe
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

function getShortcuts() {
  if (!fs.existsSync(shortcutsPath)) {
    const defaults = [
      { name: "Google", url: "https://google.com" },
      { name: "GitHub", url: "https://github.com" },
      { name: "YouTube", url: "https://youtube.com" },
      { name: "Reddit", url: "https://reddit.com" }
    ];
    fs.writeFileSync(shortcutsPath, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  try {
    return JSON.parse(fs.readFileSync(shortcutsPath, "utf8"));
  } catch (e) {
    return [];
  }
}

function getSettingsFile() {
  const defaultSettings = {
    remember: false,
    confirm: true,
    language: "system"
  };
  if (!fs.existsSync(settingsPath)) {
    fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2));
    return defaultSettings;
  }
  try {
    return JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch (e) {
    console.error("Error reading settings.json:", e);
    return defaultSettings;
  }
}

function getSearchEngine() {
  const defaultEngine = { url: "https://www.google.com/search?q=" };
  if (!fs.existsSync(searchEnginePath)) {
    fs.writeFileSync(searchEnginePath, JSON.stringify(defaultEngine, null, 2));
    return defaultEngine.url;
  }
  try {
    const data = JSON.parse(fs.readFileSync(searchEnginePath, "utf8"));
    return data.url || defaultEngine.url;
  } catch (e) {
    return defaultEngine.url;
  }
}

function getCustomSearchEngines() {
  if (!fs.existsSync(customSearchPath)) {
    const defaults = [
      { name: "Bing", url: "https://www.bing.com/search?q=" },
      { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=" }
    ];
    fs.writeFileSync(customSearchPath, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  try {
    return JSON.parse(fs.readFileSync(customSearchPath, "utf8"));
  } catch (e) { return []; }
}

async function downloadFavicon(url, name) {
  try {
    const domain = new URL(url).hostname;
    const iconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
    const iconPath = path.join(iconsDir, `${Buffer.from(name).toString('hex')}.png`);
    
    const { net } = require('electron');
    const request = net.request(iconUrl);
    
    return new Promise((resolve) => {
      request.on('response', (response) => {
        const data = [];
        response.on('data', (chunk) => data.push(chunk));
        response.on('end', () => {
          const buffer = Buffer.concat(data);
          fs.writeFileSync(iconPath, buffer);
          resolve(`local-icon://${Buffer.from(name).toString('hex')}.png`);
        });
      });
      request.on('error', () => resolve(null));
      request.end();
    });
  } catch (e) { return null; }
}

function cleanupIcons(shortcuts) {
  const activeIcons = shortcuts.map(s => `${Buffer.from(s.name).toString('hex')}.png`);
  fs.readdirSync(iconsDir).forEach(file => {
    if (!activeIcons.includes(file)) fs.unlinkSync(path.join(iconsDir, file));
  });
}

// AdBlocker State & List
let adBlockEnabled = true;
const adBlockList = [
  "doubleclick.net", "adservice.google.com", "googleadservices.com",
  "googlesyndication.com", "adnxs.com", "carbonads.net", "adroll.com",
  "outbrain.com", "taboola.com", "serving-sys.com", "scorecardresearch.com"
];

// ID de modelo de usuario para que Windows reconozca el icono en la barra de tareas
if (process.platform === "win32") {
  app.setAppUserModelId("com.stormgamesstudios.stormbrowser");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    backgroundColor: "#0f0f13",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      // nodeIntegration must be true so the renderer can use ipcRenderer directly
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
      spellcheck: true,
      sandbox: false,
    },
    icon: path.join(__dirname, process.platform === 'win32' ? "renderer/assets/icon.ico" : "renderer/assets/icon.png"),
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, "renderer/index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow.maximize();
    mainWindow.show();
    // Check for updates once the window is visible (only in packaged app)
    if (app.isPackaged && autoUpdater) {
      autoUpdater.checkForUpdatesAndNotify();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ─── Window controls ──────────────────────────────────────────────────────────
ipcMain.on("window-minimize", () => mainWindow?.minimize());
ipcMain.on("window-maximize", () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.on("window-close", () => mainWindow?.close());
ipcMain.handle("window-is-maximized", () => mainWindow?.isMaximized() ?? false);

ipcMain.handle("get-app-version", () => app.getVersion());
ipcMain.on("get-app-version-sync", (event) => {
  event.returnValue = app.getVersion();
});
ipcMain.on("get-settings-sync", (event) => {
  event.returnValue = getSettingsFile();
});

ipcMain.handle("get-settings", () => getSettingsFile());
ipcMain.handle("save-settings", (event, settings) => {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  return true;
});
ipcMain.handle("get-shortcuts", () => getShortcuts());
ipcMain.handle("get-search-engine", () => getSearchEngine());
ipcMain.handle("get-custom-search-engines", () => getCustomSearchEngines());

ipcMain.handle("save-search-engine", (event, url) => {
  fs.writeFileSync(searchEnginePath, JSON.stringify({ url }, null, 2));
  return true;
});

ipcMain.handle("save-custom-search-engines", (event, engines) => {
  fs.writeFileSync(customSearchPath, JSON.stringify(engines, null, 2));
  return true;
});

ipcMain.handle("save-shortcuts", async (event, shortcuts) => {
  if (Array.isArray(shortcuts) && shortcuts.length <= 8) {
    for (let s of shortcuts) {
      if (s.url && s.url !== 'https://' && !s.icon) s.icon = await downloadFavicon(s.url, s.name);
    }
    fs.writeFileSync(shortcutsPath, JSON.stringify(shortcuts, null, 2));
    cleanupIcons(shortcuts);
    return true;
  }
  return false;
});

ipcMain.handle("get-translations", (event, langCode) => {
  let targetLang = langCode;
  if (!targetLang || targetLang === 'system') {
    const sysLang = app.getLocale().split('-')[0];
    targetLang = ['es', 'en', 'eu'].includes(sysLang) ? sysLang : 'en';
  }
  try {
    const data = require(path.join(__dirname, `renderer/lang/${targetLang}.json`));
    return { lang: targetLang, data };
  } catch (e) {
    return { lang: 'en', data: require(path.join(__dirname, 'renderer/lang/en.json')) };
  }
});

// ─── Updater IPC ──────────────────────────────────────────────────────────────
if (autoUpdater) {
  autoUpdater.on("update-available", () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      
      mainWindow.setResizable(true); // Permitir cambio temporal
      mainWindow.setMinimumSize(500, 600);
      mainWindow.setSize(500, 600);
      mainWindow.setResizable(false);
      mainWindow.setMaximizable(false);
      mainWindow.center();
      mainWindow.loadFile(path.join(__dirname, "renderer/update.html"));
    }
  });
  autoUpdater.on("download-progress", (progressObj) => {
    mainWindow?.webContents.send("download-progress", progressObj);
  });
  autoUpdater.on("update-downloaded", () => {
    mainWindow?.webContents.send("update-downloaded");
  });
}

ipcMain.on("check-for-updates", () => {
  if (app.isPackaged && autoUpdater) {
    autoUpdater.checkForUpdatesAndNotify();
  } else {
    console.log("Update check requested in development mode.");
  }
});

ipcMain.on("install-update", () => {
  autoUpdater?.quitAndInstall();
});

ipcMain.on("toggle-adblock", (event, enabled) => {
  adBlockEnabled = enabled;
});
ipcMain.handle("get-adblock-state", () => adBlockEnabled);

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Registrar protocolo para iconos locales
  session.defaultSession.protocol.registerFileProtocol('local-icon', (request, callback) => {
    const url = request.url.replace('local-icon://', '');
    try {
      return callback(path.join(iconsDir, url));
    } catch (e) { return callback({ error: -6 }); }
  });

  // Menú contextual global (Clic derecho) con soporte para Corrector Ortográfico
  app.on('web-contents-created', (event, contents) => {
    contents.on('context-menu', (event, params) => {
      const menu = new Menu();

      // Sugerencias de ortografía
      for (const suggestion of params.dictionarySuggestions) {
        menu.append(new MenuItem({
          label: suggestion,
          click: () => contents.replaceMisspelling(suggestion)
        }));
      }

      if (params.dictionarySuggestions.length > 0) menu.append(new MenuItem({ type: 'separator' }));

      menu.append(new MenuItem({ label: 'Atrás', enabled: contents.canGoBack(), click: () => contents.goBack() }));
      menu.append(new MenuItem({ label: 'Adelante', enabled: contents.canGoForward(), click: () => contents.goForward() }));
      menu.append(new MenuItem({ label: 'Recargar', click: () => contents.reload() }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ label: 'Cortar', role: 'cut', enabled: params.editFlags.canCut }));
      menu.append(new MenuItem({ label: 'Copiar', role: 'copy', enabled: params.editFlags.canCopy }));
      menu.append(new MenuItem({ label: 'Pegar', role: 'paste', enabled: params.editFlags.canPaste }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ label: 'Inspeccionar', click: () => contents.inspectElement(params.x, params.y) }));

      menu.popup();
    });
  });

  // Strip CSP headers so webviews can load any page freely
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    delete headers["content-security-policy"];
    delete headers["Content-Security-Policy"];
    callback({ responseHeaders: headers });
  });

  // Implementación del AdBlocker
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (details, callback) => {
    if (adBlockEnabled) {
      const isAd = adBlockList.some(domain => details.url.includes(domain));
      if (isAd) {
        console.log("Blocked ad:", details.url);
        return callback({ cancel: true });
      }
    }
    callback({ cancel: false });
  });

  // Gestión de progreso de descargas en la barra de tareas
  session.defaultSession.on("will-download", (event, item) => {
    item.on("updated", (event, state) => {
      if (state === "progressing") {
        if (
          mainWindow &&
          !mainWindow.isDestroyed() &&
          item.getTotalBytes() > 0
        ) {
          mainWindow.setProgressBar(
            item.getReceivedBytes() / item.getTotalBytes(),
          );
        }
      }
    });
    item.once("done", (event, state) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setProgressBar(-1); // Resetear barra al finalizar
      }
    });
  });

  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
