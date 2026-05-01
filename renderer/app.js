// With nodeIntegration:true we can require Electron APIs directly
const { ipcRenderer } = require("electron");

// ─── State ────────────────────────────────────────────────────────────────────
let tabs = [];
let i18n = {};
let activeTabId = null;
let tabCounter = 0;

const HOME_URL = "newtab";
let SEARCH_ENGINE = "https://www.google.com/search?q=";

// ─── DOM Refs ─────────────────────────────────────────────────────────────────
const tabsContainer = document.getElementById("tabs-container");
const webviewContainer = document.getElementById("webview-container");
const newTabPage = document.getElementById("new-tab-page");
const urlBar = document.getElementById("url-bar");
const lockIcon = document.getElementById("lock-icon");
const loadingSpinner = document.getElementById("loading-spinner");
const btnBack = document.getElementById("btn-back");
const btnForward = document.getElementById("btn-forward");
const btnReload = document.getElementById("btn-reload");
const btnHome = document.getElementById("btn-home");
const btnAdblock = document.getElementById("btn-adblock");
const btnInfo = document.getElementById("btn-info");
const btnSettings = document.getElementById("btn-settings");
const ntpSearch = document.getElementById("ntp-search");
const ntpSearchBtn = document.getElementById("ntp-search-btn");

const modalOverlay = document.getElementById("modal-overlay");
const btnExitCancel = document.getElementById("btn-exit-cancel");
const btnExitClose = document.getElementById("btn-exit-close");
const btnExitSave = document.getElementById("btn-exit-save");
const dontAskExit = document.getElementById("dont-ask-exit");

// ─── Window Controls ──────────────────────────────────────────────────────────
document.getElementById("btn-min").addEventListener("click", () => {
  ipcRenderer.send("window-minimize");
});
document.getElementById("btn-max").addEventListener("click", () => {
  ipcRenderer.send("window-maximize");
});
document.getElementById("btn-close").addEventListener("click", () => {
  const settings = getSettings();
  const shouldConfirm =
    settings.confirm &&
    (tabs.length > 1 || (tabs.length === 1 && tabs[0].url !== HOME_URL));
  if (shouldConfirm) {
    modalOverlay.classList.remove("hidden");
  } else {
    if (settings.remember) saveSession();
    ipcRenderer.send("window-close");
  }
});

// ─── Tab Management ───────────────────────────────────────────────────────────
function createTab(url = HOME_URL) {
  const id = ++tabCounter;
  const isNewTab = url === HOME_URL;

  let webview = null;
  if (!isNewTab) {
    webview = createWebview(id, url);
    webviewContainer.appendChild(webview);
  }

  const tab = {
    id,
    url,
    title: isNewTab ? (i18n.new_tab || "New Tab") : url,
    favicon: null,
    loading: !isNewTab,
    webview,
    canGoBack: false,
    canGoForward: false,
  };

  tabs.push(tab);
  renderTabEl(tab);
  switchTab(id);

  if (getSettings().remember) saveSession();
  return tab;
}

function renderTabEl(tab) {
  const el = document.createElement("div");
  el.className = "tab";
  el.id = `tab-${tab.id}`;
  el.dataset.id = tab.id;

  el.innerHTML = `
    <div class="tab-favicon-placeholder" id="tab-fav-${tab.id}">
      <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
        <circle cx="4.5" cy="4.5" r="3.5" stroke="currentColor" stroke-width="1.2"/>
      </svg>
    </div>
    <span class="tab-title" id="tab-title-${tab.id}">${escHtml(tab.title)}</span>
    <button class="tab-close" title="Close tab">
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
        <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>
    </button>
  `;

  el.addEventListener("click", (e) => {
    if (e.target.closest(".tab-close")) return;
    switchTab(tab.id);
  });

  // Cierre con clic central (rueda del ratón)
  el.addEventListener("auxclick", (e) => {
    if (e.button === 1) {
      e.preventDefault(); // Prevenir cualquier comportamiento por defecto del clic central
      closeTab(tab.id);
    }
  });

  el.querySelector(".tab-close").addEventListener("click", (e) => {
    e.stopPropagation();
    closeTab(tab.id);
  });

  tabsContainer.appendChild(el);
}

function updateTabEl(tab) {
  const titleEl = document.getElementById(`tab-title-${tab.id}`);
  const favEl = document.getElementById(`tab-fav-${tab.id}`);

  if (titleEl) titleEl.textContent = tab.title;

  if (favEl) {
    if (tab.loading) {
      favEl.outerHTML = `<div class="tab-loading-dot" id="tab-fav-${tab.id}"></div>`;
    } else if (tab.favicon) {
      favEl.outerHTML = `<img class="tab-favicon" id="tab-fav-${tab.id}" src="${tab.favicon}" onerror="this.style.display='none'"/>`;
    } else {
      favEl.outerHTML = `
        <div class="tab-favicon-placeholder" id="tab-fav-${tab.id}">
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
            <circle cx="4.5" cy="4.5" r="3.5" stroke="currentColor" stroke-width="1.2"/>
          </svg>
        </div>`;
    }
  }
}

function switchTab(id) {
  activeTabId = id;

  document.querySelectorAll(".tab").forEach((el) => {
    el.classList.toggle("active", parseInt(el.dataset.id) === id);
  });
  document.querySelectorAll("webview").forEach((wv) => {
    wv.classList.toggle("active", parseInt(wv.dataset.tabId) === id);
  });

  const tab = getTab(id);
  if (!tab) return;

  const isNewTab = tab.url === HOME_URL;
  newTabPage.classList.toggle("hidden", !isNewTab);
  urlBar.value = isNewTab ? "" : tab.url;
  updateNavButtons(tab);
  updateLockIcon(tab.url);

  // Asegurar que la pestaña sea visible al seleccionarla
  const tabEl = document.getElementById(`tab-${id}`);
  if (tabEl) {
    tabEl.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }
}

function closeTab(id) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;

  const tab = tabs[idx];
  if (tab.webview) tab.webview.remove();

  const tabEl = document.getElementById(`tab-${id}`);
  if (tabEl) tabEl.remove();

  tabs.splice(idx, 1);

  if (tabs.length === 0) {
    createTab();
    return;
  }

  if (activeTabId === id) {
    const next = tabs[Math.min(idx, tabs.length - 1)];
    switchTab(next.id);
  }

  if (getSettings().remember) saveSession();
}

function getTab(id) {
  return tabs.find((t) => t.id === id);
}
function getActiveTab() {
  return getTab(activeTabId);
}

// ─── Webview ──────────────────────────────────────────────────────────────────
function createWebview(tabId, url) {
  const wv = document.createElement("webview");
  wv.src = url;
  wv.dataset.tabId = tabId;
  wv.setAttribute("allowpopups", "");

  wv.addEventListener("did-start-loading", () => {
    const tab = getTab(tabId);
    if (!tab) return;
    tab.loading = true;
    updateTabEl(tab);
    if (tabId === activeTabId) {
      loadingSpinner.classList.remove("hidden");
      setStopIcon();
    }
  });

  wv.addEventListener("did-stop-loading", () => {
    const tab = getTab(tabId);
    if (!tab) return;
    tab.loading = false;
    tab.canGoBack = wv.canGoBack();
    tab.canGoForward = wv.canGoForward();
    updateTabEl(tab);
    if (tabId === activeTabId) {
      loadingSpinner.classList.add("hidden");
      setReloadIcon();
      updateNavButtons(tab);
      updateLockIcon(tab.url);
    }
  });

  wv.addEventListener("page-title-updated", (e) => {
    const tab = getTab(tabId);
    if (!tab) return;
    tab.title = e.title || tab.url;
    updateTabEl(tab);
  });

  wv.addEventListener("page-favicon-updated", (e) => {
    const tab = getTab(tabId);
    if (!tab) return;
    tab.favicon = e.favicons?.[0] || null;
    updateTabEl(tab);
  });

  wv.addEventListener("did-navigate", (e) => {
    const tab = getTab(tabId);
    if (!tab) return;
    tab.url = e.url;
    tab.canGoBack = wv.canGoBack();
    tab.canGoForward = wv.canGoForward();
    if (tabId === activeTabId) {
      urlBar.value = e.url;
      updateNavButtons(tab);
      updateLockIcon(e.url);
      if (getSettings().remember) saveSession();
    }
  });

  wv.addEventListener("did-navigate-in-page", (e) => {
    const tab = getTab(tabId);
    if (!tab) return;
    tab.url = e.url;
    tab.canGoBack = wv.canGoBack();
    tab.canGoForward = wv.canGoForward();
    if (tabId === activeTabId) {
      urlBar.value = e.url;
      updateNavButtons(tab);
    }
  });

  wv.addEventListener("new-window", (e) => {
    createTab(e.url);
  });

  return wv;
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function navigate(url) {
  if (!url || !url.trim()) return;
  url = url.trim();

  let finalUrl;
  if (/^https?:\/\//i.test(url) || url.startsWith("file://")) {
    finalUrl = url;
  } else if (url === HOME_URL) {
    finalUrl = HOME_URL;
  } else if (/^[\w-]+(\.\w{2,})(\/.*)?$/.test(url) && !url.includes(" ")) {
    finalUrl = "https://" + url;
  } else {
    finalUrl = SEARCH_ENGINE + encodeURIComponent(url);
  }

  const tab = getActiveTab();
  if (!tab) return;

  if (finalUrl === HOME_URL) {
    tab.url = HOME_URL;
    tab.title = i18n.new_tab || "New Tab";
    tab.favicon = null;
    tab.loading = false;
    if (tab.webview) {
      tab.webview.remove();
      tab.webview = null;
    }
    updateTabEl(tab);
    urlBar.value = "";
    newTabPage.classList.remove("hidden");
    updateNavButtons(tab);
    return;
  }

  if (!tab.webview) {
    const wv = createWebview(tab.id, finalUrl);
    webviewContainer.appendChild(wv);
    tab.webview = wv;
    wv.classList.add("active");
  } else {
    tab.webview.loadURL(finalUrl);
  }

  newTabPage.classList.add("hidden");
  tab.url = finalUrl;
  urlBar.value = finalUrl;
  updateLockIcon(finalUrl);
}

function updateNavButtons(tab) {
  btnBack.disabled = !tab?.canGoBack;
  btnForward.disabled = !tab?.canGoForward;
}

function updateLockIcon(url) {
  lockIcon.className = "";
  if (!url || url === HOME_URL) {
    lockIcon.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.3"/>
      <path d="M4 6l1.5 1.5L8 4.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    return;
  }
  if (url.startsWith("https://")) {
    lockIcon.classList.add("secure");
    lockIcon.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="2" y="5.5" width="8" height="5.5" rx="1.2" stroke="currentColor" stroke-width="1.3"/>
      <path d="M4 5.5V4a2 2 0 1 1 4 0v1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    </svg>`;
  } else {
    lockIcon.classList.add("insecure");
    lockIcon.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    </svg>`;
  }
}

function setStopIcon() {
  btnReload.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`;
}

function setReloadIcon() {
  btnReload.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5c1.8 0 3.4.87 4.4 2.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M12 2v3h-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

// ─── Navbar listeners ─────────────────────────────────────────────────────────
document
  .getElementById("new-tab-btn")
  .addEventListener("click", () => createTab());

btnBack.addEventListener("click", () => {
  const tab = getActiveTab();
  if (tab?.webview?.canGoBack()) tab.webview.goBack();
});

btnForward.addEventListener("click", () => {
  const tab = getActiveTab();
  if (tab?.webview?.canGoForward()) tab.webview.goForward();
});

btnReload.addEventListener("click", () => {
  const tab = getActiveTab();
  if (!tab?.webview) return;
  tab.loading ? tab.webview.stop() : tab.webview.reload();
});

btnHome.addEventListener("click", () => navigate(HOME_URL));

btnAdblock.addEventListener("click", async () => {
  const currentState = await ipcRenderer.invoke("get-adblock-state");
  const newState = !currentState;
  ipcRenderer.send("toggle-adblock", newState);
  updateAdblockUI(newState);
});

async function updateAdblockUI(enabled) {
  if (enabled) {
    btnAdblock.style.color = "var(--accent)";
    btnAdblock.title = i18n.adblock_enabled || "AdBlock: ON";
  } else {
    btnAdblock.style.color = "var(--text-muted)";
    btnAdblock.title = i18n.adblock_disabled || "AdBlock: OFF";
  }
}

btnInfo.addEventListener("click", () => {
  const infoPath = "file://" + __dirname + "/StormGamesStudios/info.html";
  navigate(infoPath);
});

btnSettings.addEventListener("click", () => {
  const settingsPath =
    "file://" + __dirname + "/StormGamesStudios/settings.html";
  navigate(settingsPath);
});

// ─── Modal Logic ──────────────────────────────────────────────────────────────
btnExitCancel.addEventListener("click", () =>
  modalOverlay.classList.add("hidden"),
);

btnExitClose.addEventListener("click", () => {
  handleExitSettings(false);
  ipcRenderer.send("window-close");
});

btnExitSave.addEventListener("click", () => {
  handleExitSettings(true);
  saveSession();
  ipcRenderer.send("window-close");
});

function handleExitSettings(willRemember) {
  if (dontAskExit.checked) { // Si el usuario marcó "No volver a preguntar"
    const settings = getSettings(); // Obtener los ajustes actuales
    settings.confirm = false; // Desactivar la confirmación
    settings.remember = willRemember; // Guardar la preferencia de recordar pestañas
    ipcRenderer.invoke("save-settings", settings); // Guardar los ajustes actualizados
  }
}

async function initSearchEngine() {
  SEARCH_ENGINE = await ipcRenderer.invoke("get-search-engine");
}

async function loadShortcuts() {
  const shortcuts = await ipcRenderer.invoke("get-shortcuts");
  const container = document.getElementById("ntp-shortcuts");
  if (!container) return;
  container.innerHTML = "";
  shortcuts.forEach(s => {
    const el = document.createElement("div");
    el.className = "shortcut";
    const iconHtml = s.icon 
      ? `<img src="${s.icon}" class="shortcut-icon-img" onerror="this.src=''; this.parentElement.innerHTML='${s.name.charAt(0).toUpperCase()}'">`
      : `<div class="shortcut-icon-text">${s.name.charAt(0).toUpperCase()}</div>`;
      
    el.innerHTML = `<div class="shortcut-icon">${iconHtml}</div><span>${escHtml(s.name)}</span>`;
    el.addEventListener("click", () => navigate(s.url));
    container.appendChild(el);
  });
}

async function initI18n() {
  const settings = getSettings();
  const res = await ipcRenderer.invoke('get-translations', settings.language);
  i18n = res.data;
  applyTranslations();
}

function applyTranslations() {
  // Navegación y Tooltips
  btnBack.title = i18n.back;
  btnForward.title = i18n.forward;
  btnReload.title = i18n.reload;
  btnHome.title = i18n.home;
  btnInfo.title = i18n.info;
  btnSettings.title = i18n.settings;
  document.getElementById('new-tab-btn').title = i18n.new_tab;
  urlBar.placeholder = i18n.search_placeholder;

  // Modal de salida
  document.querySelector('#exit-modal h3').textContent = i18n.close_modal_title;
  document.querySelector('#exit-modal p').textContent = i18n.close_modal_desc;
  btnExitCancel.textContent = i18n.cancel;
  btnExitClose.textContent = i18n.just_close;
  btnExitSave.textContent = i18n.save_and_close;
  // Traducir el texto del checkbox de "no volver a preguntar"
  const label = document.querySelector('.modal-options label');
  if (label) {
    label.childNodes[1].textContent = " " + i18n.dont_ask_again;
  }

  // Página de nueva pestaña (NTP)
  ntpSearch.placeholder = i18n.search_placeholder;
  document.querySelector('#ntp-logo span').textContent = i18n.app_name;
  
  // Actualizar títulos de pestañas existentes si son "New Tab"
  tabs.forEach(t => { if (t.url === HOME_URL) { t.title = i18n.new_tab; updateTabEl(t); } });
}

function getSettings() {
  // Ahora los ajustes se cargan del proceso principal
  // Esto es síncrono para evitar problemas de timing al inicio
  // En un entorno real, esto debería ser asíncrono y manejarse con promesas.
  return ipcRenderer.sendSync("get-settings-sync");
}

function saveSession() {
  const urls = tabs.map((t) => t.url).filter((u) => u !== HOME_URL);
  localStorage.setItem("storm_session", JSON.stringify(urls));
}

urlBar.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    navigate(urlBar.value);
    urlBar.blur();
  }
  if (e.key === "Escape") {
    const tab = getActiveTab();
    urlBar.value = tab?.url === HOME_URL ? "" : tab?.url || "";
    urlBar.blur();
  }
});

urlBar.addEventListener("focus", () => urlBar.select());

// Scroll horizontal con la rueda del ratón en las pestañas
tabsContainer.addEventListener("wheel", (e) => {
  if (e.deltaY !== 0) {
    e.preventDefault();
    tabsContainer.scrollLeft += e.deltaY;
  }
});

// NTP search
function ntpNavigate() {
  const q = ntpSearch.value.trim();
  if (!q) return;
  ntpSearch.value = "";
  navigate(q);
}
ntpSearch.addEventListener("keydown", (e) => {
  if (e.key === "Enter") ntpNavigate();
});
ntpSearchBtn.addEventListener("click", ntpNavigate);

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key === "t") {
    e.preventDefault();
    createTab();
  }
  if (ctrl && e.key === "w") {
    e.preventDefault();
    if (activeTabId) closeTab(activeTabId);
  }
  if (ctrl && e.key === "l") {
    e.preventDefault();
    urlBar.focus();
  }
  if (ctrl && e.key === "r") {
    e.preventDefault();
    btnReload.click();
  }
  if (e.altKey && e.key === "ArrowLeft") {
    e.preventDefault();
    btnBack.click();
  }
  if (e.altKey && e.key === "ArrowRight") {
    e.preventDefault();
    btnForward.click();
  }
  if (ctrl && e.key >= "1" && e.key <= "9") {
    const idx = parseInt(e.key) - 1;
    if (tabs[idx]) switchTab(tabs[idx].id);
  }
});

// ─── Utility ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Init ─────────────────────────────────────────────────────────────────────
const savedUrls = JSON.parse(localStorage.getItem("storm_session") || "[]");
const settings = getSettings();
initI18n(); 
initSearchEngine();
ipcRenderer.invoke("get-adblock-state").then(updateAdblockUI);
loadShortcuts();

if (settings.remember && savedUrls.length > 0) {
  savedUrls.forEach((url) => createTab(url));
} else {
  createTab();
}
