const {
  app,
  BrowserWindow,
  Menu,
  clipboard,
  dialog,
  ipcMain,
  session,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const Store = require("electron-store").default;

const store = new Store();
const historyPath = path.join(app.getPath("userData"), "history.json");
const welcomeSettingsPath = path.join(
  app.getPath("appData"),
  "StormGamesStudios",
  "Programs",
  "StormBrowser",
  "settings",
  "welcome.settings",
);
const extensionsDirectory = path.join(
  path.dirname(path.dirname(welcomeSettingsPath)),
  "extensions",
);

function ensureAppDirectories() {
  fs.mkdirSync(path.dirname(welcomeSettingsPath), { recursive: true });
  fs.mkdirSync(extensionsDirectory, { recursive: true });
}

function getUBlockExtensionPath() {
  const extensionPath = app.isPackaged
    ? path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "ublock",
        "upstream",
      )
    : path.join(__dirname, "ublock", "upstream");
  const manifestPath = path.join(extensionPath, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No se encontró el manifiesto de uBlock Origin: ${manifestPath}`);
  }
  return extensionPath;
}

function getInstalledExtensions() {
  ensureAppDirectories();
  return fs
    .readdirSync(extensionsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const folderPath = path.join(extensionsDirectory, entry.name);
      try {
        const manifest = JSON.parse(
          fs.readFileSync(path.join(folderPath, "extension.json"), "utf8"),
        );
        const metadata = manifest?.extension;
        if (
          !metadata ||
          typeof metadata.name !== "string" ||
          typeof metadata.id !== "string"
        ) {
          throw new Error("El manifiesto debe incluir el nombre y el ID de la extensión.");
        }

        const iconPath =
          typeof metadata.icons === "string"
            ? path.resolve(folderPath, metadata.icons)
            : "";
        const iconRelativePath = iconPath ? path.relative(folderPath, iconPath) : "";
        let icon = "";
        if (
          iconPath &&
          iconRelativePath &&
          !iconRelativePath.startsWith(`..${path.sep}`) &&
          iconRelativePath !== ".." &&
          !path.isAbsolute(iconRelativePath) &&
          fs.existsSync(iconPath) &&
          fs.statSync(iconPath).isFile() &&
          fs.statSync(iconPath).size <= 1024 * 1024
        ) {
          const mimeTypes = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".webp": "image/webp",
          };
          const mimeType = mimeTypes[path.extname(iconPath).toLowerCase()];
          if (mimeType) {
            icon = `data:${mimeType};base64,${fs.readFileSync(iconPath).toString("base64")}`;
          }
        }

        return {
          name: metadata.name,
          id: metadata.id,
          author: typeof metadata.author === "string" ? metadata.author : "",
          version: typeof metadata.version === "string" ? metadata.version : "",
          description:
            metadata.description ||
            metadata.information ||
            metadata.info ||
            manifest.description ||
            "",
          type: typeof manifest?.loader?.type === "string" ? manifest.loader.type : "",
          folder: entry.name,
          icon,
          enabled: store.get("enabled-extensions", {})[metadata.id] !== false,
          error: "",
        };
      } catch (error) {
        console.error(`Failed to load extension in ${folderPath}:`, error);
        return {
          name: entry.name,
          id: "",
          author: "",
          version: "",
          description: "",
          type: "",
          folder: entry.name,
          icon: "",
          enabled: false,
          error: error.message,
        };
      }
    });
}

function getBackgroundExtensionStyles() {
  const allowedProperties = new Set([
    "background-color",
    "background-image",
    "background-position",
    "background-repeat",
    "background-size",
  ]);
  const styles = [];

  for (const extension of getInstalledExtensions()) {
    if (!extension.id || !extension.enabled || extension.type !== "background") {
      continue;
    }

    const folderPath = path.join(extensionsDirectory, extension.folder);
    const stylesheetPath = path.join(folderPath, "src", "style.css");
    if (!fs.existsSync(stylesheetPath)) continue;

    try {
      const stylesheet = fs.readFileSync(stylesheetPath, "utf8");
      const rules = stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g);
      for (const [, selectorText, declarations] of rules) {
        const selectors = selectorText.split(",").map((selector) => selector.trim().toLowerCase());
        if (!selectors.some((selector) => selector === "body" || selector === "html")) {
          continue;
        }

        for (const declaration of declarations.split(";")) {
          const separator = declaration.indexOf(":");
          if (separator < 1) continue;
          const property = declaration.slice(0, separator).trim().toLowerCase();
          let value = declaration.slice(separator + 1).trim();
          if (
            !allowedProperties.has(property) ||
            !value ||
            /[{};]/.test(value)
          ) {
            continue;
          }

          value = value.replace(/url\((['"]?)(.*?)\1\)/gi, (_match, _quote, resource) => {
            if (
              !resource ||
              path.isAbsolute(resource) ||
              /^[a-z][a-z\d+.-]*:/i.test(resource)
            ) {
              return "none";
            }
            const resourcePath = path.resolve(path.dirname(stylesheetPath), resource);
            const relativePath = path.relative(folderPath, resourcePath);
            if (
              relativePath === ".." ||
              relativePath.startsWith(`..${path.sep}`) ||
              path.isAbsolute(relativePath) ||
              !fs.existsSync(resourcePath) ||
              !fs.statSync(resourcePath).isFile()
            ) {
              return "none";
            }
            return `url("${pathToFileURL(resourcePath).href}")`;
          });
          styles.push({ property, value });
        }
      }
    } catch (error) {
      console.error(`Failed to load background styles for ${extension.id}:`, error);
    }
  }
  return styles;
}

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
} catch (_) { }

let mainWindow;
let splashWindow;
let uBlockExtensionId;
let uBlockDashboardWindow;
let contextMenuI18n = {};

// ─── Load context menu translations ────────────────────────────────────────────
function loadContextMenuTranslations(language) {
  try {
    let lang = language;
    if (!lang || lang === "auto") {
      const sysLocale = app.getLocale() || "en";
      lang = sysLocale.startsWith("es")
        ? "es"
        : sysLocale.startsWith("eu")
          ? "eu"
          : "en";
    }
    const langFile = path.join(__dirname, "renderer", "assets", "lang", "context-menu", `${lang}.json`);
    if (fs.existsSync(langFile)) {
      contextMenuI18n = JSON.parse(fs.readFileSync(langFile, "utf8"));
    } else {
      const fallbackFile = path.join(__dirname, "renderer", "assets", "lang", "context-menu", "en.json");
      contextMenuI18n = JSON.parse(fs.readFileSync(fallbackFile, "utf8"));
    }
  } catch (err) {
    console.error("Failed to load context menu translations:", err);
    contextMenuI18n = {
      open_link_new_tab: "Open Link in New Tab",
      copy_link_address: "Copy Link Address",
      open_image_new_tab: "Open Image in New Tab",
      copy_image_address: "Copy Image Address",
      add_to_dictionary: "Add to Dictionary",
      inspect_element: "Inspect Element",
    };
  }
}

// ─── AdBlocker ────────────────────────────────────────────────────────────────
function getSpellCheckerLanguages(language) {
  if (!language || language === "auto") return null;
  if (language.startsWith("en")) return ["en-US"];
  if (language.startsWith("es")) return ["es-ES"];
  if (language.startsWith("eu")) return [];
  return [language];
}

function updateSpellCheckerLanguages(sessionInstance, language) {
  if (!sessionInstance || process.platform === "darwin") return;
  const languages = getSpellCheckerLanguages(language);
  if (languages !== null) {
    try {
      sessionInstance.setSpellCheckerLanguages(languages);
    } catch (err) {
      console.error("Failed to set spellchecker languages:", err);
    }
  }
}

async function updateAdBlocker(enabled) {
  if (enabled && !uBlockExtensionId) {
    const extension = await session.defaultSession.extensions.loadExtension(
      getUBlockExtensionPath(),
    );
    uBlockExtensionId = extension.id;
  } else if (!enabled && uBlockExtensionId) {
    session.defaultSession.extensions.removeExtension(uBlockExtensionId);
    uBlockExtensionId = undefined;
    if (uBlockDashboardWindow && !uBlockDashboardWindow.isDestroyed()) {
      uBlockDashboardWindow.close();
    }
  }
}

async function openUBlockDashboard() {
  if (!uBlockExtensionId) {
    throw new Error("uBlock Origin no está activado.");
  }

  if (uBlockDashboardWindow && !uBlockDashboardWindow.isDestroyed()) {
    uBlockDashboardWindow.show();
    uBlockDashboardWindow.focus();
    return;
  }

  uBlockDashboardWindow = new BrowserWindow({
    width: 1000,
    height: 760,
    title: "uBlock Origin",
    webPreferences: {
      session: session.defaultSession,
    },
  });
  uBlockDashboardWindow.on("closed", () => {
    uBlockDashboardWindow = undefined;
  });
  try {
    await uBlockDashboardWindow.loadURL(
      `chrome-extension://${uBlockExtensionId}/dashboard.html`,
    );
  } catch (error) {
    uBlockDashboardWindow.close();
    throw error;
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
      label: contextMenuI18n.add_to_dictionary || "Add to Dictionary",
      click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
    });
    template.push({ type: "separator" });
  }

  if (params.linkURL) {
    template.push({
      label: contextMenuI18n.open_link_new_tab || "Open Link in New Tab",
      click: () => mainWindow?.webContents.send("context-menu-open-link-new-tab", params.linkURL),
    });
    template.push({
      label: contextMenuI18n.copy_link_address || "Copy Link Address",
      click: () => clipboard.writeText(params.linkURL || ""),
    });
  }

  if (params.mediaType === "image" && params.srcURL) {
    template.push({
      label: contextMenuI18n.open_image_new_tab || "Open Image in New Tab",
      click: () => mainWindow?.webContents.send("context-menu-open-link-new-tab", params.srcURL),
    });
    template.push({
      label: contextMenuI18n.copy_image_address || "Copy Image Address",
      click: () => clipboard.writeText(params.srcURL || ""),
    });
  }

  if (template.length > 0) {
    template.push({ type: "separator" });
  }

  if (params.isEditable) {
    template.push(
      {
        label: contextMenuI18n.undo || "Undo",
        role: "undo",
      },
      {
        label: contextMenuI18n.redo || "Redo",
        role: "redo",
      },
      { type: "separator" },
      {
        label: contextMenuI18n.cut || "Cut",
        role: "cut",
      },
      {
        label: contextMenuI18n.copy || "Copy",
        role: "copy",
      },
      {
        label: contextMenuI18n.paste || "Paste",
        role: "paste",
      },
      { type: "separator" },
      {
        label: contextMenuI18n.select_all || "Select All",
        role: "selectAll",
      },
    );
  } else {
    template.push(
      {
        label: contextMenuI18n.copy || "Copy",
        role: "copy",
      },
      {
        label: contextMenuI18n.select_all || "Select All",
        role: "selectAll",
      },
    );
  }

  template.push({ type: "separator" });
  template.push({
    label: contextMenuI18n.inspect_element || "Inspect Element",
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

// ─── IPC: Extensions ─────────────────────────────────────────────────────────
ipcMain.handle("get-extensions", () => getInstalledExtensions());
ipcMain.handle("open-ublock-dashboard", () => openUBlockDashboard());
ipcMain.handle("set-extension-enabled", (_event, id, enabled) => {
  if (typeof id !== "string" || typeof enabled !== "boolean") {
    throw new Error("La extensión y su estado no son válidos.");
  }
  if (!getInstalledExtensions().some((extension) => extension.id === id)) {
    throw new Error(`No se encontró la extensión ${id}.`);
  }

  const enabledExtensions = store.get("enabled-extensions", {});
  store.set("enabled-extensions", { ...enabledExtensions, [id]: enabled });
});
ipcMain.handle("get-background-extension-styles", () =>
  getBackgroundExtensionStyles(),
);

// ─── IPC: Settings ────────────────────────────────────────────────────────────
ipcMain.handle("get-settings", () => ({
  splash: true,
  restoreTabs: false,
  closeWarn: true,
  language: "auto",
  startMaximized: false,
  adBlock: true,
  searchEngine: "google",
  historyNewTab: true,
  aiEnabled: true,
  ...store.get("settings", {}),
}));
async function persistSettings(settings) {
  const old = store.get("settings");
  if (old?.adBlock !== settings.adBlock) {
    await updateAdBlocker(settings.adBlock !== false);
  }
  store.set("settings", settings);
  if (old?.language !== settings.language) {
    loadContextMenuTranslations(settings.language);
    updateSpellCheckerLanguages(mainWindow?.webContents?.session, settings.language);
  }
}
ipcMain.handle("save-settings", (_, settings) => persistSettings(settings));
ipcMain.handle("is-welcome-completed", () => {
  try {
    return fs.readFileSync(welcomeSettingsPath, "utf8").trim() === "yes";
  } catch (err) {
    if (err.code === "ENOENT") return false;
    console.error("Failed to read welcome completion marker:", err);
    throw err;
  }
});
ipcMain.handle("complete-welcome", async (_, settings) => {
  await persistSettings(settings);
  try {
    fs.mkdirSync(path.dirname(welcomeSettingsPath), { recursive: true });
    fs.writeFileSync(welcomeSettingsPath, "yes", "utf8");
  } catch (err) {
    console.error("Failed to write welcome completion marker:", err);
    throw err;
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
app.whenReady().then(async () => {
  ensureAppDirectories();
  const settings = store.get("settings", { adBlock: true });
  try {
    await updateAdBlocker(settings.adBlock !== false);
  } catch (error) {
    console.error("Failed to load uBlock Origin:", error);
    dialog.showErrorBox(
      "uBlock Origin",
      `No se pudo cargar uBlock Origin. El navegador continuará sin bloqueo de anuncios.\n\n${error.message}`,
    );
  }

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    delete headers["content-security-policy"];
    delete headers["Content-Security-Policy"];
    callback({ responseHeaders: headers });
  });

  loadContextMenuTranslations(settings.language);
  if (settings.splash) createSplash();
  createMainWindow();
  if (mainWindow?.webContents?.session) {
    updateSpellCheckerLanguages(mainWindow.webContents.session, settings.language);
  }
}).catch((error) => {
  console.error("Failed to initialize StormBrowser:", error);
  dialog.showErrorBox("StormBrowser", error.message);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
