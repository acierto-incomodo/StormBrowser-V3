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
function ensureAppDirectories() {
  fs.mkdirSync(path.dirname(welcomeSettingsPath), { recursive: true });
}

function getUBlockExtensionPath() {
  return app.isPackaged
    ? path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "ublock",
        "upstream",
      )
    : path.join(__dirname, "ublock", "upstream");
}

function normalizeExtensionPath(extensionPath) {
  const normalizedPath = path.resolve(extensionPath);
  return process.platform === "win32" ? normalizedPath.toLowerCase() : normalizedPath;
}

function getUserExtensionPaths() {
  const paths = store.get("extension-paths", []);
  return Array.isArray(paths)
    ? paths.filter((extensionPath) => typeof extensionPath === "string")
    : [];
}

function getExtensionPaths() {
  return [
    getUBlockExtensionPath(),
    ...getUserExtensionPaths(),
  ].filter(
    (extensionPath, index, paths) =>
      paths.findIndex(
        (candidate) =>
          normalizeExtensionPath(candidate) ===
          normalizeExtensionPath(extensionPath),
      ) === index,
  );
}

function getLoadedExtension(extensionPath) {
  return session.defaultSession.extensions
    .getAllExtensions()
    .find(
      (extension) =>
        normalizeExtensionPath(extension.path) ===
        normalizeExtensionPath(extensionPath),
    );
}

function getExtensionList() {
  const rememberedIds = store.get("extension-ids", {});
  return getExtensionPaths().map((extensionPath) => {
    const pathKey = normalizeExtensionPath(extensionPath);
    const loadedExtension = getLoadedExtension(extensionPath);
    let manifest = loadedExtension?.manifest || {};
    let error = extensionLoadErrors.get(pathKey) || "";

    try {
      const parsedManifest = JSON.parse(
        fs.readFileSync(path.join(extensionPath, "manifest.json"), "utf8"),
      );
      if (!parsedManifest || typeof parsedManifest !== "object" || Array.isArray(parsedManifest)) {
        throw new Error("manifest.json must contain an extension manifest object.");
      }
      manifest = parsedManifest;
    } catch (loadError) {
      error = loadError.message;
    }

    const manifestOptionsPage =
      manifest.options_ui?.page || manifest.options_page || "";

    return {
      id: loadedExtension?.id || rememberedIds[pathKey] || "",
      name:
        loadedExtension?.name ||
        (typeof manifest.name === "string" ? manifest.name : path.basename(extensionPath)),
      author: typeof manifest.author === "string" ? manifest.author : "",
      version: loadedExtension?.version || manifest.version || "",
      description: typeof manifest.description === "string" ? manifest.description : "",
      path: extensionPath,
      enabled: Boolean(loadedExtension),
      builtIn:
        normalizeExtensionPath(extensionPath) ===
        normalizeExtensionPath(getUBlockExtensionPath()),
      hasOptionsPage: Boolean(manifestOptionsPage),
      error,
    };
  });
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
const extensionLoadErrors = new Map();
const extensionOptionsWindows = new Map();
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
    rememberExtensionId(getUBlockExtensionPath(), extension.id);
  } else if (!enabled && uBlockExtensionId) {
    closeExtensionOptions(uBlockExtensionId);
    session.defaultSession.extensions.removeExtension(uBlockExtensionId);
    uBlockExtensionId = undefined;
  }
}

function closeExtensionOptions(extensionId) {
  const optionsWindow = extensionOptionsWindows.get(extensionId);
  if (optionsWindow && !optionsWindow.isDestroyed()) {
    optionsWindow.close();
  }
}

function rememberExtensionId(extensionPath, extensionId) {
  const pathKey = normalizeExtensionPath(extensionPath);
  store.set("extension-ids", {
    ...store.get("extension-ids", {}),
    [pathKey]: extensionId,
  });
}

async function loadUserExtensions() {
  const disabledPaths = store.get("disabled-extension-paths", {});
  const bundledPath = normalizeExtensionPath(getUBlockExtensionPath());
  for (const extensionPath of getUserExtensionPaths()) {
    const pathKey = normalizeExtensionPath(extensionPath);
    if (pathKey === bundledPath || disabledPaths[pathKey]) continue;

    try {
      const extension = await session.defaultSession.extensions.loadExtension(
        extensionPath,
      );
      rememberExtensionId(extensionPath, extension.id);
      extensionLoadErrors.delete(pathKey);
    } catch (error) {
      extensionLoadErrors.set(pathKey, error.message);
      console.error(`Failed to load unpacked extension from ${extensionPath}:`, error);
    }
  }
}

async function setExtensionEnabled(extensionPath, enabled) {
  const registeredPath = getExtensionPaths().find(
    (candidate) =>
      normalizeExtensionPath(candidate) ===
      normalizeExtensionPath(extensionPath),
  );
  if (!registeredPath) {
    throw new Error("No se encontró la extensión seleccionada.");
  }

  const pathKey = normalizeExtensionPath(registeredPath);
  const isBundledExtension =
    pathKey === normalizeExtensionPath(getUBlockExtensionPath());

  if (isBundledExtension) {
    await updateAdBlocker(enabled);
    store.set("settings", {
      ...store.get("settings", {}),
      adBlock: enabled,
    });
    mainWindow?.webContents.send("extension-settings-changed");
    return;
  }

  const loadedExtension = getLoadedExtension(registeredPath);
  if (enabled && !loadedExtension) {
    try {
      const extension = await session.defaultSession.extensions.loadExtension(
        registeredPath,
      );
      rememberExtensionId(registeredPath, extension.id);
      extensionLoadErrors.delete(pathKey);
    } catch (error) {
      extensionLoadErrors.set(pathKey, error.message);
      throw error;
    }
  } else if (!enabled && loadedExtension) {
    closeExtensionOptions(loadedExtension.id);
    session.defaultSession.extensions.removeExtension(loadedExtension.id);
  }

  const disabledPaths = store.get("disabled-extension-paths", {});
  if (enabled) {
    delete disabledPaths[pathKey];
  } else {
    disabledPaths[pathKey] = true;
  }
  store.set("disabled-extension-paths", disabledPaths);
}

async function installUnpackedExtension() {
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: "Load unpacked extension",
    properties: ["openDirectory"],
  });
  if (selection.canceled || selection.filePaths.length === 0) return;

  const extensionPath = path.resolve(selection.filePaths[0]);
  const alreadyRegistered = getExtensionPaths().some(
    (candidate) =>
      normalizeExtensionPath(candidate) ===
      normalizeExtensionPath(extensionPath),
  );
  if (alreadyRegistered && getLoadedExtension(extensionPath)) {
    return;
  }

  if (
    normalizeExtensionPath(extensionPath) ===
    normalizeExtensionPath(getUBlockExtensionPath())
  ) {
    await updateAdBlocker(true);
    store.set("settings", {
      ...store.get("settings", {}),
      adBlock: true,
    });
    return;
  }

  const userPaths = getUserExtensionPaths();
  if (!alreadyRegistered) {
    userPaths.push(extensionPath);
    store.set("extension-paths", userPaths);
  }

  const disabledPaths = store.get("disabled-extension-paths", {});
  delete disabledPaths[normalizeExtensionPath(extensionPath)];
  store.set("disabled-extension-paths", disabledPaths);

  try {
    const extension = await session.defaultSession.extensions.loadExtension(
      extensionPath,
    );
    rememberExtensionId(extensionPath, extension.id);
    extensionLoadErrors.delete(normalizeExtensionPath(extensionPath));
  } catch (error) {
    extensionLoadErrors.set(normalizeExtensionPath(extensionPath), error.message);
    throw error;
  }
}

function removeUserExtension(extensionPath) {
  const pathKey = normalizeExtensionPath(extensionPath);
  const registeredPath = getUserExtensionPaths().find(
    (candidate) => normalizeExtensionPath(candidate) === pathKey,
  );
  if (!registeredPath) {
    throw new Error("No se encontró la extensión seleccionada.");
  }

  const loadedExtension = getLoadedExtension(registeredPath);
  if (loadedExtension) {
    closeExtensionOptions(loadedExtension.id);
    session.defaultSession.extensions.removeExtension(loadedExtension.id);
  }
  store.set(
    "extension-paths",
    getUserExtensionPaths().filter(
      (candidate) => normalizeExtensionPath(candidate) !== pathKey,
    ),
  );
  const disabledPaths = store.get("disabled-extension-paths", {});
  delete disabledPaths[pathKey];
  store.set("disabled-extension-paths", disabledPaths);
  const rememberedIds = store.get("extension-ids", {});
  delete rememberedIds[pathKey];
  store.set("extension-ids", rememberedIds);
  extensionLoadErrors.delete(pathKey);
}

async function openExtensionOptions(extensionId) {
  const extension = session.defaultSession.extensions.getExtension(extensionId);
  if (!extension) {
    throw new Error("La extensión no está activada.");
  }

  const optionsPage =
    extension.manifest.options_ui?.page || extension.manifest.options_page;
  if (typeof optionsPage !== "string" || !optionsPage) {
    throw new Error("Esta extensión no tiene una página de configuración.");
  }

  const optionsUrl = new URL(
    optionsPage,
    `chrome-extension://${extension.id}/`,
  );
  if (
    optionsUrl.protocol !== "chrome-extension:" ||
    optionsUrl.hostname !== extension.id
  ) {
    throw new Error("La página de configuración de la extensión no es válida.");
  }

  const existingWindow = extensionOptionsWindows.get(extension.id);
  if (existingWindow && !existingWindow.isDestroyed()) {
    existingWindow.show();
    existingWindow.focus();
    return;
  }

  const optionsWindow = new BrowserWindow({
    width: 1000,
    height: 760,
    title: extension.name,
    webPreferences: {
      session: session.defaultSession,
    },
  });
  extensionOptionsWindows.set(extension.id, optionsWindow);
  optionsWindow.on("closed", () => {
    extensionOptionsWindows.delete(extension.id);
  });
  try {
    await optionsWindow.loadURL(optionsUrl.href);
  } catch (error) {
    optionsWindow.close();
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
ipcMain.handle("get-extensions", () => getExtensionList());
ipcMain.handle("install-unpacked-extension", () => installUnpackedExtension());
ipcMain.handle("set-extension-enabled", (_event, extensionPath, enabled) => {
  if (typeof extensionPath !== "string" || typeof enabled !== "boolean") {
    throw new Error("La extensión y su estado no son válidos.");
  }
  return setExtensionEnabled(extensionPath, enabled);
});
ipcMain.handle("remove-extension", (_event, extensionPath) => {
  if (typeof extensionPath !== "string") {
    throw new Error("La extensión seleccionada no es válida.");
  }
  return removeUserExtension(extensionPath);
});
ipcMain.handle("open-extension-options", (_event, extensionId) => {
  if (typeof extensionId !== "string" || !extensionId) {
    throw new Error("El identificador de la extensión no es válido.");
  }
  return openExtensionOptions(extensionId);
});

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
  await loadUserExtensions();

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
