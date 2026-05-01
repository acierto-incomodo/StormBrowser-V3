const { app, BrowserWindow, ipcMain, session, shell, protocol } = require("electron");
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

protocol.registerSchemesAsPrivileged([
  { scheme: "stormbrowser", privileges: { standard: true, secure: true } }
]);

let mainWindow;

// Ruta para archivos externos editables (fuera de ASAR)
const extraFilesPath = app.isPackaged
  ? path.join(process.resourcesPath, "extraFiles")
  : path.join(__dirname, "renderer", "extraFiles");

if (!fs.existsSync(extraFilesPath)) { fs.mkdirSync(extraFilesPath, { recursive: true }); }

const shortcutsPath = path.join(extraFilesPath, "shortcuts.json");
const searchEnginePath = path.join(extraFilesPath, "search-engine.json");

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
      sandbox: false,
    },
    icon: path.join(__dirname, process.platform === 'win32' ? "renderer/assets/icon.ico" : "renderer/assets/icon.png"),
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, "renderer/index.html"));

  mainWindow.once("ready-to-show", () => {
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

ipcMain.handle("get-shortcuts", () => getShortcuts());
ipcMain.handle("get-search-engine", () => getSearchEngine());

ipcMain.handle("save-search-engine", (event, url) => {
  fs.writeFileSync(searchEnginePath, JSON.stringify({ url }, null, 2));
  return true;
});

ipcMain.handle("save-shortcuts", (event, shortcuts) => {
  if (Array.isArray(shortcuts) && shortcuts.length <= 8) {
    fs.writeFileSync(shortcutsPath, JSON.stringify(shortcuts, null, 2));
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

ipcMain.on("install-update", () => {
  autoUpdater?.quitAndInstall();
});

ipcMain.on("toggle-adblock", (event, enabled) => {
  adBlockEnabled = enabled;
});
ipcMain.handle("get-adblock-state", () => adBlockEnabled);

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Registro del protocolo stormbrowser:
  protocol.registerFileProtocol("stormbrowser", (request, callback) => {
    const url = request.url.replace("stormbrowser:", "");
    const host = url.replace(/^\/\//, "").split("/")[0].split("?")[0];

    let filePath = "";
    if (host === "index" || host === "newtab") {
      filePath = path.join(__dirname, "renderer", "index.html");
    } else if (host === "settings") {
      filePath = path.join(__dirname, "renderer", "StormGamesStudios", "settings.html");
    } else if (host === "info") {
      filePath = path.join(__dirname, "renderer", "StormGamesStudios", "info.html");
    }
    callback({ path: path.normalize(filePath) });
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
