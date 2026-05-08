const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

// ─── Constants ────────────────────────────────────────────────────────────────
const HOME_URL      = 'storm://newtab';
const SETTINGS_URL  = 'storm://settings';
const INFO_URL      = 'storm://info';
const SEARCH_ENGINE = 'https://www.google.com/search?q=';

// ─── State ────────────────────────────────────────────────────────────────────
let tabs        = [];
let activeTabId = null;
let tabCounter  = 0;
let settings    = { splash: true, restoreTabs: false, closeWarn: true, language: 'auto', startMaximized: false };
let i18n        = {};

// ─── DOM ──────────────────────────────────────────────────────────────────────
const tabsContainer   = document.getElementById('tabs-container');
const tabScrollLeft   = document.getElementById('tab-scroll-left');
const closeOverlayTitle = document.querySelector('.dialog-title');
const tabScrollRight  = document.getElementById('tab-scroll-right');
const webviewContainer= document.getElementById('webview-container');
const newTabPage      = document.getElementById('new-tab-page');
const urlBar          = document.getElementById('url-bar');
const lockIcon        = document.getElementById('lock-icon');
const loadingSpinner  = document.getElementById('loading-spinner');
const btnBack         = document.getElementById('btn-back');
const btnForward      = document.getElementById('btn-forward');
const btnReload       = document.getElementById('btn-reload');
const btnHome         = document.getElementById('btn-home');
const btnSettings     = document.getElementById('btn-settings');
const ntpSearch       = document.getElementById('ntp-search');
const ntpSearchBtn    = document.getElementById('ntp-search-btn');
const updateBanner    = document.getElementById('update-banner');
const closeOverlay    = document.getElementById('close-overlay');
const closeDialogMsg  = document.getElementById('close-dialog-msg');
const dialogCancel    = document.getElementById('dialog-cancel');
const dialogConfirm   = document.getElementById('dialog-confirm');

let dialogAction = null; // Para saber qué hacer al confirmar el diálogo

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  // Load settings from main process (electron-store)
  settings = await ipcRenderer.invoke('get-settings');
  await loadLocale();

  // Restore tabs or open a new one
  if (settings.restoreTabs) {
    const saved = await ipcRenderer.invoke('get-saved-tabs');
    if (saved && saved.length > 0) {
      saved.forEach(url => createTab(url));
    } else {
      createTab();
    }
  } else {
    createTab();
  }
}

// ─── Window Controls ──────────────────────────────────────────────────────────
document.getElementById('btn-min').addEventListener('click',   () => ipcRenderer.send('window-minimize'));
document.getElementById('btn-max').addEventListener('click',   () => ipcRenderer.send('window-maximize'));
document.getElementById('btn-close').addEventListener('click', () => requestClose());

// ─── Close confirmation ───────────────────────────────────────────────────────
function requestClose() {
  if (!settings.closeWarn && tabs.length <= 1) { ipcRenderer.send('window-close'); return; }

  const nonHome = tabs.filter(t => t.url !== HOME_URL);
  const multi   = tabs.length > 1;
  const single  = tabs.length === 1 && nonHome.length === 1;

  if (multi) {
    showCustomDialog(
      i18n.confirm_close_title || 'Close StormBrowser?',
      (i18n.confirm_close_multi || 'You have {n} tabs open.').replace('{n}', tabs.length),
      () => ipcRenderer.send('window-close')
    );
  } else if (single) {
    showCustomDialog(
      i18n.confirm_close_title || 'Close StormBrowser?',
      i18n.confirm_close_msg || 'Are you sure you want to close?',
      () => ipcRenderer.send('window-close')
    );
  } else {
    ipcRenderer.send('window-close');
  }
}

// ─── Settings sync ────────────────────────────────────────────────────────────
// Listen for settings changes dispatched from settings page
window.addEventListener('settings-changed', async () => {
  settings = await ipcRenderer.invoke('get-settings');
  await loadLocale();
});
// Also handle postMessage from settings webview
window.addEventListener('message', (e) => {
  if (e.data?.type === 'save-settings') {
    // Save settings to main process and update local state
    const langChanged = settings.language !== e.data.settings.language;
    ipcRenderer.send('save-settings', e.data.settings);
    settings = e.data.settings;
    if (langChanged) location.reload();
  } else if (e.data?.type === 'settings-changed') {
    ipcRenderer.invoke('get-settings').then(s => { settings = s; });
  } else if (e.data?.type === 'navigate') {
    // Handle navigation requests from internal pages
    navigate(e.data.url);
  } else if (e.data?.type === 'close-all-tabs') {
    showCustomDialog(
      i18n.close_all_tabs || 'Close all tabs',
      i18n.confirm_close_all || 'Are you sure you want to close all tabs?',
      () => closeAllTabs()
    );
  }
});

// ─── Tab scroll buttons ───────────────────────────────────────────────────────
function updateScrollButtons() {
  const c = tabsContainer;
  const overflowing = c.scrollWidth > c.clientWidth + 4;
  tabScrollLeft.classList.toggle('visible',  overflowing && c.scrollLeft > 4);
  tabScrollRight.classList.toggle('visible', overflowing && c.scrollLeft < c.scrollWidth - c.clientWidth - 4);
}

tabScrollLeft.addEventListener('click',  () => { tabsContainer.scrollBy({ left: -160, behavior: 'smooth' }); });
tabScrollRight.addEventListener('click', () => { tabsContainer.scrollBy({ left:  160, behavior: 'smooth' }); });
tabsContainer.addEventListener('scroll', updateScrollButtons);

// Mouse wheel scroll on tab bar
tabsContainer.addEventListener('wheel', (e) => {
  e.preventDefault();
  tabsContainer.scrollBy({ left: e.deltaY * 1.5, behavior: 'smooth' });
}, { passive: false });

// ─── Tab Management ───────────────────────────────────────────────────────────
function createTab(url = HOME_URL) {
  const id      = ++tabCounter;
  const isInternal = isInternalUrl(url);

  let webview = null;
  if (!isInternal) {
    webview = createWebview(id, url);
    webviewContainer.appendChild(webview);
  }

  const tab = {
    id, url,
    title: tabTitleFor(url),
    favicon: null,
    loading: !isInternal,
    webview,
    canGoBack: false, canGoForward: false,
  };

  tabs.push(tab);
  renderTabEl(tab);
  switchTab(id);
  saveTabs();

  // Update scroll arrows after new tab
  setTimeout(updateScrollButtons, 50);
  return tab;
}

function tabTitleFor(url) {
  if (url === HOME_URL)     return i18n.new_tab || 'New Tab';
  if (url === SETTINGS_URL) return i18n.settings || 'Settings';
  if (url === INFO_URL)     return i18n.about || 'About StormBrowser';
  return url;
}

function isInternalUrl(url) {
  return url === HOME_URL || url === SETTINGS_URL || url === INFO_URL;
}

function renderTabEl(tab) {
  const el = document.createElement('div');
  el.className = 'tab';
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

  el.addEventListener('click', (e) => {
    if (e.target.closest('.tab-close')) return;
    switchTab(tab.id);
  });

  el.querySelector('.tab-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(tab.id);
  });

  tabsContainer.appendChild(el);
}

function updateTabEl(tab) {
  const titleEl = document.getElementById(`tab-title-${tab.id}`);
  const favEl   = document.getElementById(`tab-fav-${tab.id}`);

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

  document.querySelectorAll('.tab').forEach(el =>
    el.classList.toggle('active', parseInt(el.dataset.id) === id));

  document.querySelectorAll('webview').forEach(wv =>
    wv.classList.toggle('active', parseInt(wv.dataset.tabId) === id));

  const tab = getTab(id);
  if (!tab) return;

  const isNew      = (tab.url === HOME_URL);
  const isSettings = (tab.url === SETTINGS_URL);
  const isInfo     = (tab.url === INFO_URL);
  const isInternal = isNew || isSettings || isInfo;

  newTabPage.classList.toggle('hidden', !isNew);

  // Show/hide internal pages in webview-container
  document.getElementById('settings-page')?.remove();
  document.getElementById('info-page')?.remove();

  if (isSettings) showInternalPage('settings-page', `StormGamesStudios/../settings.html`);
  if (isInfo)     showInternalPage('info-page',     `StormGamesStudios/info.html`);

  urlBar.value = isInternal ? '' : tab.url;
  updateNavButtons(tab);
  updateLockIcon(tab.url);

  // Scroll active tab into view
  document.getElementById(`tab-${id}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  setTimeout(updateScrollButtons, 100);
}

function showInternalPage(elId, src) {
  const iframe = document.createElement('iframe');
  iframe.id = elId;
  iframe.src = src;
  iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none;background:#0f0f13;';
  webviewContainer.appendChild(iframe);
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;

  const tab = tabs[idx];
  if (tab.webview) tab.webview.remove();

  document.getElementById(`tab-${id}`)?.remove();
  tabs.splice(idx, 1);

  if (tabs.length === 0) { createTab(); return; }

  if (activeTabId === id) {
    switchTab(tabs[Math.min(idx, tabs.length - 1)].id);
  }

  saveTabs();
  setTimeout(updateScrollButtons, 50);
}

function closeAllTabs() {
  tabs.forEach(t => { if (t.webview) t.webview.remove(); });
  tabsContainer.innerHTML = '';
  tabs = [];
  activeTabId = null;
  tabCounter = 0;

  createTab();
  setTimeout(updateScrollButtons, 50);
}

function showCustomDialog(title, msg, onConfirm) {
  if (closeOverlayTitle) closeOverlayTitle.textContent = title;
  closeDialogMsg.textContent = msg;
  dialogAction = onConfirm;
  closeOverlay.classList.remove('hidden');
}

function hideCloseDialog() { 
  closeOverlay.classList.add('hidden');
  dialogAction = null;
}

dialogCancel.addEventListener('click', hideCloseDialog);
dialogConfirm.addEventListener('click', () => { if (dialogAction) dialogAction(); hideCloseDialog(); });
closeOverlay.addEventListener('click', (e) => { if (e.target === closeOverlay) hideCloseDialog(); });

function getTab(id)     { return tabs.find(t => t.id === id); }
function getActiveTab() { return getTab(activeTabId); }

function saveTabs() {
  if (!settings.restoreTabs) return;
  const urls = tabs.map(t => t.url); // Guardar todas las URLs, incluyendo HOME_URL
  ipcRenderer.send('save-tabs', urls);
}

// ─── Webview ──────────────────────────────────────────────────────────────────
function createWebview(tabId, url) {
  const wv = document.createElement('webview');
  wv.src = url;
  wv.dataset.tabId = tabId;
  wv.setAttribute('allowpopups', '');

  wv.addEventListener('did-start-loading', () => {
    const tab = getTab(tabId);
    if (!tab) return;
    tab.loading = true; updateTabEl(tab);
    if (tabId === activeTabId) { loadingSpinner.classList.remove('hidden'); setStopIcon(); }
  });

  wv.addEventListener('did-stop-loading', () => {
    const tab = getTab(tabId);
    if (!tab) return;
    tab.loading = false;
    tab.canGoBack    = wv.canGoBack();
    tab.canGoForward = wv.canGoForward();
    updateTabEl(tab);
    if (tabId === activeTabId) {
      loadingSpinner.classList.add('hidden'); setReloadIcon();
      updateNavButtons(tab); updateLockIcon(tab.url);
    }
  });

  wv.addEventListener('page-title-updated', (e) => {
    const tab = getTab(tabId);
    if (!tab) return;
    tab.title = e.title || tab.url; updateTabEl(tab);
  });

  wv.addEventListener('page-favicon-updated', (e) => {
    const tab = getTab(tabId);
    if (!tab) return;
    tab.favicon = e.favicons?.[0] || null; updateTabEl(tab);
  });

  wv.addEventListener('did-navigate', (e) => {
    const tab = getTab(tabId);
    if (!tab) return;
    tab.url = e.url;
    tab.canGoBack = wv.canGoBack(); tab.canGoForward = wv.canGoForward();
    if (tabId === activeTabId) {
      urlBar.value = e.url; updateNavButtons(tab); updateLockIcon(e.url);
    }
    saveTabs();
  });

  wv.addEventListener('did-navigate-in-page', (e) => {
    const tab = getTab(tabId);
    if (!tab) return;
    tab.url = e.url;
    tab.canGoBack = wv.canGoBack(); tab.canGoForward = wv.canGoForward();
    if (tabId === activeTabId) { urlBar.value = e.url; updateNavButtons(tab); }
    saveTabs();
  });

  wv.addEventListener('new-window', (e) => { createTab(e.url); });

  return wv;
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function navigate(url) {
  if (!url?.trim()) return;
  url = url.trim();

  let finalUrl;
  if (url === HOME_URL || url === SETTINGS_URL || url === INFO_URL) {
    finalUrl = url;
  } else if (/^https?:\/\//i.test(url)) {
    finalUrl = url;
  } else if (/^[\w-]+(\.\w{2,})(\/.*)?$/.test(url) && !url.includes(' ')) {
    finalUrl = 'https://' + url;
  } else {
    finalUrl = SEARCH_ENGINE + encodeURIComponent(url);
  }

  const tab = getActiveTab();
  if (!tab) return;

  if (isInternalUrl(finalUrl)) {
    // Remove old webview if switching to internal
    if (tab.webview) { tab.webview.remove(); tab.webview = null; }
    tab.url = finalUrl; tab.title = tabTitleFor(finalUrl);
    tab.loading = false; tab.favicon = null;
    updateTabEl(tab);
    switchTab(tab.id);
    return;
  }

  if (!tab.webview) {
    const wv = createWebview(tab.id, finalUrl);
    webviewContainer.appendChild(wv);
    tab.webview = wv;
    wv.classList.add('active');
  } else {
    tab.webview.loadURL(finalUrl);
  }

  newTabPage.classList.add('hidden');
  document.getElementById('settings-page')?.remove();
  document.getElementById('info-page')?.remove();

  tab.url = finalUrl;
  urlBar.value = finalUrl;
  updateLockIcon(finalUrl);
}

function updateNavButtons(tab) {
  btnBack.disabled    = !(tab?.canGoBack);
  btnForward.disabled = !(tab?.canGoForward);
}

function updateLockIcon(url) {
  lockIcon.className = '';
  if (!url || isInternalUrl(url)) {
    lockIcon.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.3"/>
      <path d="M4 6l1.5 1.5L8 4.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`; return;
  }
  if (url.startsWith('https://')) {
    lockIcon.classList.add('secure');
    lockIcon.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="2" y="5.5" width="8" height="5.5" rx="1.2" stroke="currentColor" stroke-width="1.3"/>
      <path d="M4 5.5V4a2 2 0 1 1 4 0v1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    </svg>`;
  } else {
    lockIcon.classList.add('insecure');
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
document.getElementById('new-tab-btn').addEventListener('click', () => createTab());

btnBack.addEventListener('click', () => {
  const tab = getActiveTab();
  if (tab?.webview?.canGoBack()) tab.webview.goBack();
});
btnForward.addEventListener('click', () => {
  const tab = getActiveTab();
  if (tab?.webview?.canGoForward()) tab.webview.goForward();
});
btnReload.addEventListener('click', () => {
  const tab = getActiveTab();
  if (!tab?.webview) return;
  tab.loading ? tab.webview.stop() : tab.webview.reload();
});
btnHome.addEventListener('click',     () => navigate(HOME_URL));
btnSettings.addEventListener('click', () => navigate(SETTINGS_URL));

urlBar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { navigate(urlBar.value); urlBar.blur(); }
  if (e.key === 'Escape') {
    const tab = getActiveTab();
    urlBar.value = isInternalUrl(tab?.url) ? '' : (tab?.url || '');
    urlBar.blur();
  }
});
urlBar.addEventListener('focus', () => urlBar.select());

function ntpNavigate() {
  const q = ntpSearch.value.trim();
  if (!q) return;
  ntpSearch.value = '';
  navigate(q);
}
ntpSearch.addEventListener('keydown', (e) => { if (e.key === 'Enter') ntpNavigate(); });
ntpSearchBtn.addEventListener('click', ntpNavigate);

document.querySelectorAll('.shortcut').forEach(el =>
  el.addEventListener('click', () => navigate(el.dataset.url)));

// ─── Auto-updater ─────────────────────────────────────────────────────────────
ipcRenderer.on('update-available', () => {
  if (updateBanner) {
    updateBanner.textContent = '⬇ Downloading update...';
    updateBanner.classList.remove('hidden');
  }
});
ipcRenderer.on('update-downloaded', () => {
  if (updateBanner) {
    updateBanner.innerHTML = '✓ Update ready — <button id="install-update-btn">Restart & Install</button>';
    updateBanner.classList.remove('hidden');
    document.getElementById('install-update-btn')?.addEventListener('click', () =>
      ipcRenderer.send('install-update'));
  }
});

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key === 't') { e.preventDefault(); createTab(); }
  if (ctrl && e.key === 'w') { e.preventDefault(); if (activeTabId) closeTab(activeTabId); }
  if (ctrl && e.key === 'l') { e.preventDefault(); urlBar.focus(); }
  if (ctrl && e.key === 'r') { e.preventDefault(); btnReload.click(); }
  if (ctrl && e.key === ',') { e.preventDefault(); navigate(SETTINGS_URL); }
  if (e.altKey && e.key === 'ArrowLeft')  { e.preventDefault(); btnBack.click(); }
  if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); btnForward.click(); }
  if (ctrl && e.key >= '1' && e.key <= '9') {
    const idx = parseInt(e.key) - 1;
    if (tabs[idx]) switchTab(tabs[idx].id);
  }
  if (e.key === 'Escape' && !closeOverlay.classList.contains('hidden')) {
    hideCloseDialog();
  }
});

// ─── Utility ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Localization ─────────────────────────────────────────────────────────────
async function loadLocale() {
  let lang = settings.language;
  if (!lang || lang === 'auto') {
    const sys = await ipcRenderer.invoke('get-app-locale');
    if (sys.startsWith('es')) lang = 'es';
    else if (sys.startsWith('eu')) lang = 'eu';
    else lang = 'en';
  }

  try {
    const langPath = path.join(__dirname, 'assets', 'lang', 'index', `${lang}.json`);
    const data = fs.readFileSync(langPath, 'utf8');
    i18n = JSON.parse(data);
    applyTranslations();
  } catch (err) { console.error('Localization error:', err); }
}

function applyTranslations() {
  if (urlBar) urlBar.placeholder = i18n.search_placeholder || '';
  if (ntpSearch) ntpSearch.placeholder = i18n.ntp_placeholder || '';
  
  document.getElementById('btn-settings')?.setAttribute('title', i18n.settings || '');
  document.getElementById('btn-min')?.setAttribute('title', i18n.minimize || '');
  document.getElementById('btn-max')?.setAttribute('title', i18n.maximize || '');
  document.getElementById('btn-close')?.setAttribute('title', i18n.close || '');
  document.getElementById('btn-home')?.setAttribute('title', i18n.home || '');
  document.getElementById('new-tab-btn')?.setAttribute('title', (i18n.new_tab || 'New tab') + ' (Ctrl+T)');
  
  const dCancel = document.getElementById('dialog-cancel');
  const dConfirm = document.getElementById('dialog-confirm');
  if (dCancel) dCancel.textContent = i18n.cancel || 'Cancel';
  if (dConfirm) dConfirm.textContent = i18n.close || 'Close';

  tabs.forEach(t => { t.title = tabTitleFor(t.url); updateTabEl(t); });
}

// ─── Start ────────────────────────────────────────────────────────────────────
init();
