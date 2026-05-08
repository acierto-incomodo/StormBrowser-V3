const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store').default;

const store = new Store();

let autoUpdater;
try {
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
} catch (_) {}

let mainWindow;
let splashWindow;

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
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  splashWindow.loadFile(path.join(__dirname, 'renderer/splash.html'));
}

// ─── Main window ──────────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0f0f13',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      nodeIntegrationInSubFrames: true,
      contextIsolation: false,
      webviewTag: true,
      sandbox: false
    },
    icon: path.join(__dirname, 'renderer/assets/img/icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    // Check splash setting
    const settings = store.get('settings', { splash: true, restoreTabs: false, closeWarn: true, language: 'auto' });

    if (settings.splash && splashWindow) {
      // Show splash for at least 1.6s
      setTimeout(() => {
        splashWindow?.close();
        splashWindow = null;
        mainWindow.show();
        if (app.isPackaged && autoUpdater) autoUpdater.checkForUpdatesAndNotify();
      }, 1600);
    } else {
      splashWindow?.close();
      splashWindow = null;
      mainWindow.show();
      if (app.isPackaged && autoUpdater) autoUpdater.checkForUpdatesAndNotify();
    }
  });

  // Close warning — handled in renderer, but also catch system close
  mainWindow.on('close', (e) => {
    // renderer sends 'confirm-close' after user confirms, so we just forward
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── IPC: Window controls ─────────────────────────────────────────────────────
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());
ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false);

// ─── IPC: Settings ────────────────────────────────────────────────────────────
ipcMain.handle('get-settings', () => store.get('settings', { splash: true, restoreTabs: false, closeWarn: true, language: 'auto' }));
ipcMain.on('save-settings', (_, settings) => store.set('settings', settings));
ipcMain.handle('get-app-locale', () => app.getLocale());

ipcMain.handle('list-locales', () => {
  try {
    const langDir = path.join(__dirname, 'renderer/assets/lang/index');
    return fs.readdirSync(langDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  } catch (e) { return ['en']; }
});

// ─── IPC: Saved tabs ─────────────────────────────────────────────────────────
ipcMain.handle('get-saved-tabs', () => store.get('saved-tabs', []));
ipcMain.on('save-tabs', (_, tabs) => store.set('saved-tabs', tabs));

// ─── IPC: Updater ────────────────────────────────────────────────────────────
if (autoUpdater) {
  autoUpdater.on('update-available',  () => mainWindow?.webContents.send('update-available'));
  autoUpdater.on('update-downloaded', () => mainWindow?.webContents.send('update-downloaded'));
}
ipcMain.on('install-update', () => autoUpdater?.quitAndInstall());

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    delete headers['content-security-policy'];
    delete headers['Content-Security-Policy'];
    callback({ responseHeaders: headers });
  });

  const settings = store.get('settings', { splash: true });
  if (settings.splash) createSplash();
  createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
