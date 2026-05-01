const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');

// electron-updater — only active in packaged builds
let autoUpdater;
try {
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
} catch (_) {
  // Not installed or running in dev without it
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0f0f13',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // nodeIntegration must be true so the renderer can use ipcRenderer directly
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
      sandbox: false
    },
    icon: path.join(__dirname, 'renderer/assets/icon.png'),
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Check for updates once the window is visible (only in packaged app)
    if (app.isPackaged && autoUpdater) {
      autoUpdater.checkForUpdatesAndNotify();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── Window controls ──────────────────────────────────────────────────────────
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.on('window-close', () => mainWindow?.close());
ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false);

// ─── Updater IPC ──────────────────────────────────────────────────────────────
if (autoUpdater) {
  autoUpdater.on('update-available', () => {
    mainWindow?.webContents.send('update-available');
  });
  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('update-downloaded');
  });
}

ipcMain.on('install-update', () => {
  autoUpdater?.quitAndInstall();
});

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Strip CSP headers so webviews can load any page freely
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    delete headers['content-security-policy'];
    delete headers['Content-Security-Policy'];
    callback({ responseHeaders: headers });
  });

  // Gestión de progreso de descargas en la barra de tareas
  session.defaultSession.on('will-download', (event, item) => {
    item.on('updated', (event, state) => {
      if (state === 'progressing') {
        if (mainWindow && !mainWindow.isDestroyed() && item.getTotalBytes() > 0) {
          mainWindow.setProgressBar(item.getReceivedBytes() / item.getTotalBytes());
        }
      }
    });
    item.once('done', (event, state) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setProgressBar(-1); // Resetear barra al finalizar
      }
    });
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
