const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let updateWindow;
let translations = {};

// Desactivamos la descarga automática para controlarla desde la interfaz de actualización
autoUpdater.autoDownload = false;

/**
 * Carga el archivo de traducción basado en el idioma del sistema.
 */
function loadTranslations() {
  const locale = app.getLocale().split('-')[0]; // Obtiene 'es', 'en' o 'eu'
  const supported = ['en', 'es', 'eu'];
  const lang = supported.includes(locale) ? locale : 'en';
  const langPath = path.join(__dirname, 'renderer', 'assets', 'lang', 'update', `${lang}.json`);
  
  try {
    if (fs.existsSync(langPath)) {
      translations = JSON.parse(fs.readFileSync(langPath, 'utf8'));
    } else {
      throw new Error('Archivo de idioma no encontrado');
    }
  } catch (error) {
    // Fallback manual en caso de error
    translations = {
      "title_downloading": "Downloading update...",
      "status_starting": "Starting...",
      "status_progress": "Progress: ",
      "title_ready": "Update ready!",
      "status_restarting": "Restarting application..."
    };
  }
}

function createUpdateWindow() {
  updateWindow = new BrowserWindow({
    width: 450,
    height: 250,
    frame: false,
    resizable: false,
    backgroundColor: '#1a1a1a',
    alwaysOnTop: true,
    center: true,
    webPreferences: {
      nodeIntegration: true, // Necesario para ipcRenderer en update.html
      contextIsolation: false
    }
  });

  updateWindow.loadFile(path.join(__dirname, 'renderer', 'update.html'));

  updateWindow.once('ready-to-show', () => {
    updateWindow.show();
    // Enviamos las traducciones a la ventana
    updateWindow.webContents.send('init-translations', translations);
    // Iniciamos la descarga real
    autoUpdater.downloadUpdate();
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'renderer/assets/img/logo-256x256.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadURL('https://www.google.com'); // Carga inicial
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', () => {
  loadTranslations();
  createMainWindow();
  
  // Comprobar si hay actualizaciones al iniciar
  autoUpdater.checkForUpdates();
});

// --- Eventos del autoUpdater ---

autoUpdater.on('update-available', () => {
  createUpdateWindow();
});

autoUpdater.on('download-progress', (progressObj) => {
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.webContents.send('update-progress', progressObj.percent);
  }
});

autoUpdater.on('update-downloaded', () => {
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.webContents.send('update-finished');
  }
  
  // Esperamos 3 segundos para que el usuario vea el estado final antes de reiniciar
  setTimeout(() => {
    autoUpdater.quitAndInstall();
  }, 3000);
});

autoUpdater.on('error', (err) => {
  console.error('Error en la actualización:', err);
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.close();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});