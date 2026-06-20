const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const { loadConfig, ensureNotesDir, NOTES_DIR, readHermesEnvTelegram } = require('./config');
const { getCachedApps, startAppWatchers } = require('./app-cache');
const { flushLaunchStats } = require('./handlers/apps');
const { closeDb } = require('./handlers/notes');

// Handler modules
const calcHandler = require('./handlers/calc');
const currencyHandler = require('./handlers/currency');
const unitsHandler = require('./handlers/units');
const processHandler = require('./handlers/processes');
const hermesHandler = require('./handlers/hermes');
const notesHandler = require('./handlers/notes');
const appsHandler = require('./handlers/apps');
const windowMgmtHandler = require('./handlers/window-mgmt');

let mainWindow = null;
let config = null;
let tray = null;
let isQuitting = false;
let isContextMenuOpen = false;

// --- Tray ---

function createTray() {
  const idlePath = path.join(__dirname, '..', 'assets', 'tray-icon-idle.png');
  let trayIcon;
  if (idlePath && require('fs').existsSync(idlePath)) {
    trayIcon = nativeImage.createFromPath(idlePath).resize({ width: 16, height: 16 });
  } else {
    const iconBase64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAU0lEQVR4nGNgGKygFIjPAPFPKD4DFSMIlKGK/+PAZ6BqcAJ8mpENwelsQpphGKt3iLEdryt+kmDAT5oYQLEXKA5EYl2BMxpBgOKEhOwdspIy/AQC8Z5ha7UPWCsAAAAASUVORK5CYII=';
    trayIcon = nativeImage.createFromDataURL(`data:image/png;base64,${iconBase64}`).resize({ width: 16, height: 16 });
  }
  if (process.platform === 'darwin') trayIcon.setTemplateImage(true);

  tray = new Tray(trayIcon);
  tray.setToolTip('QuickBar');

  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible()) hideWindow();
    else showWindow();
  });

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Notes Folder', click: () => { shell.openPath(NOTES_DIR).catch(() => {}); } },
    { type: 'separator' },
    { label: 'Quit QuickBar', click: () => { isQuitting = true; app.quit(); } },
  ]);

  tray.on('right-click', () => {
    isContextMenuOpen = true;
    tray.popUpContextMenu(contextMenu);
  });

  contextMenu.on('menu-will-close', () => {
    setTimeout(() => { isContextMenuOpen = false; }, 100);
  });
}

// --- Window ---

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 640, height: 84,
    frame: false, transparent: true, alwaysOnTop: true,
    show: false, resizable: false, movable: false,
    skipTaskbar: true, hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
      contextIsolation: true, sandbox: false, nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => positionWindow());

  mainWindow.on('blur', () => {
    if (mainWindow.isVisible() && !isContextMenuOpen) hideWindow();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    hideWindow();
  });
}

function positionWindow() {
  if (!mainWindow) return;
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const x = Math.round((screenWidth - 640) / 2);
  const y = Math.round(screenHeight * 0.3);
  mainWindow.setPosition(x, y);
}

function showWindow() {
  if (!mainWindow) return;
  positionWindow();
  try { mainWindow.webContents.send('clear-input'); } catch {}
  mainWindow.show();
  mainWindow.focus();
}

function hideWindow() {
  if (!mainWindow) return;
  mainWindow.hide();
}

// --- App Lifecycle ---

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.setActivationPolicy('accessory');

  config = loadConfig();
  ensureNotesDir();
  createWindow();
  createTray();
  startAppWatchers();

  // Pre-warm app cache
  getCachedApps().then(apps => {
    console.log(`[QuickBar] App cache ready: ${apps.length} apps`);
  }).catch(e => console.error('[QuickBar] App cache init failed:', e.message));

  // Register IPC handlers
  calcHandler.register(ipcMain);
  currencyHandler.register(ipcMain);
  unitsHandler.register(ipcMain);
  processHandler.register(ipcMain);
  appsHandler.register(ipcMain);
  windowMgmtHandler.register(ipcMain);
  notesHandler.register(ipcMain);
  hermesHandler.register(ipcMain, {
    config, saveToNotes: notesHandler.saveToNotes, readHermesEnvTelegram,
  });

  // Window control IPC (local — no separate handler module needed)
  ipcMain.handle('resize-window', async (event, height) => {
    if (!mainWindow) return;
    const { width } = mainWindow.getBounds();
    mainWindow.setBounds({ width, height: Math.round(height) });
  });
  ipcMain.on('hide-window', () => hideWindow());

  // Hotkey
  const registered = globalShortcut.register(config.hotkey, () => {
    if (mainWindow && mainWindow.isVisible()) hideWindow();
    else showWindow();
  });

  if (!registered) {
    console.error(`[QuickBar] Failed to register hotkey: ${config.hotkey}`);
    console.error('[QuickBar] Another app may be using it (e.g., Spotlight).');
  }
});

app.on('before-quit', () => { isQuitting = true; });

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  flushLaunchStats();
  closeDb();
});

app.on('window-all-closed', () => {});
app.on('activate', () => { if (!mainWindow) createWindow(); });