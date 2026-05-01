// With nodeIntegration: true and contextIsolation: false,
// ipcRenderer is available directly in the renderer via require().
// This preload is kept minimal — window controls are called via ipcRenderer in app.js directly.
const { ipcRenderer } = require("electron");

window.ipcRenderer = ipcRenderer;
window.APP_VERSION = ipcRenderer.sendSync("get-app-version-sync");
