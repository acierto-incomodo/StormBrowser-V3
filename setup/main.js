const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// Eliminada la variable mainWindow, ya que la ventana principal del navegador no se mostrará inicialmente.
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

// Eliminada la función createMainWindow según la solicitud de solo mostrar el proceso de actualización.

app.on('ready', () => {
  loadTranslations();
  
  // Comprobar si hay actualizaciones al iniciar
  autoUpdater.checkForUpdates();
});

// --- Eventos del autoUpdater ---

autoUpdater.on('update-available', () => {
  // Hay una actualización disponible, crear y mostrar la ventana de actualización.
  createUpdateWindow();
});

autoUpdater.on('update-not-available', () => {
  // No hay actualizaciones disponibles. Según la solicitud de "solo mostrar lo de actualizar",
  // y no mostrar la ventana principal del navegador, cerramos la aplicación.
  app.quit();
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
  // Si ocurre un error, cerrar la ventana de actualización y salir de la aplicación.
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.close();
  }
  app.quit(); // Asegurar que la aplicación se cierre en caso de error.
});

app.on('window-all-closed', () => {
  // Este manejador es típicamente para cuando todas las ventanas *principales* están cerradas.
  // En este escenario de solo actualización, si la ventana de actualización se cierra, la aplicación debería salir.
  // Con frame: false, el usuario no puede cerrarla directamente.
  // autoUpdater.quitAndInstall() o app.quit() manejarán la salida.
  if (process.platform !== 'darwin') app.quit(); // Mantener esto por robustez, aunque ahora es menos crítico.
});