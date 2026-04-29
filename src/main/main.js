const { app, BrowserWindow, globalShortcut, ipcMain, Notification, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { loadConfig, ensureNotesDir, NOTES_DIR } = require('./config');

let mainWindow = null;
let config = null;
let tray = null;
let isQuitting = false;
let isContextMenuOpen = false;

// --- Tray Icon (16x16 purple square, matches accent #8b83ff) ---

function createTray() {
  // Template icon: black circle on transparent. macOS auto-inverts for light/dark menu bar.
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  let trayIcon;
  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } else {
    // Fallback: basic 16x16 icon from base64
    const iconBase64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAU0lEQVR4nGNgGKygFIjPAPFPKD4DFSMIlKGK/+PAZ6BqcAJ8mpENwelsQpphGKt3iLEdryt+kmDAT5oYQLEXKA5EYl2BMxpBgOKEhOwdspIy/AQC8Z5ha7UPWCsAAAAASUVORK5CYII=';
    trayIcon = nativeImage.createFromDataURL(`data:image/png;base64,${iconBase64}`).resize({ width: 16, height: 16 });
  }

  // Mark as template for macOS — auto-inverts on light/dark menu bar
  if (process.platform === 'darwin') trayIcon.setTemplateImage(true);

  tray = new Tray(trayIcon);
  if (process.platform === 'darwin') tray.setIgnoreDoubleClick(true);
  tray.setToolTip('QuickBar');

  // Left-click → toggle input bar
  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible()) {
      hideWindow();
    } else {
      showWindow();
    }
  });

  // Right-click → context menu (manual, not setContextMenu which swallows click)
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Notes Folder',
      click: () => {
        const result = shell.openPath(NOTES_DIR);
        if (result && typeof result === 'string') console.error('[QuickBar] openPath error:', result);
      }
    },
    { type: 'separator' },
    {
      label: 'Quit QuickBar',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.on('right-click', () => {
    isContextMenuOpen = true;
    tray.popUpContextMenu(contextMenu);
  });

  contextMenu.on('menu-will-close', () => {
    // Delay reset so blur handler doesn't fire before menu closes
    setTimeout(() => { isContextMenuOpen = false; }, 100);
  });
}

// --- Note Helper ---

function saveToNotes(text) {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toISOString().replace('T', ' ').substring(0, 16);
  const filePath = path.join(NOTES_DIR, `${dateStr}.txt`);
  const line = `[${timeStr}] ${text}\n`;
  try {
    fs.appendFileSync(filePath, line, 'utf8');
    return { ok: true };
  } catch (e) {
    console.error('[QuickBar] Failed to save note:', e.message);
    return { ok: false, error: e.message };
  }
}

// --- Window ---

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 52,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    show: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Center window horizontally, 30% from top
  mainWindow.once('ready-to-show', () => {
    positionWindow();
    // Don't show on launch — only on hotkey
  });

  // Hide on blur (click outside) — but not when tray context menu steals focus
  mainWindow.on('blur', () => {
    if (mainWindow.isVisible() && !isContextMenuOpen) {
      hideWindow();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Prevent window close from hiding — unless app is quitting
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
  const x = Math.round((screenWidth - 600) / 2);
  const y = Math.round(screenHeight * 0.3);
  mainWindow.setPosition(x, y);
}

function showWindow() {
  if (!mainWindow) return;
  positionWindow();
  mainWindow.webContents.send('clear-input');
  mainWindow.show();
  mainWindow.focus();
}

function hideWindow() {
  if (!mainWindow) return;
  mainWindow.hide();
}

// --- macOS Notification for async errors ---

function showErrorNotification(message) {
  if (Notification.isSupported()) {
    new Notification({
      title: 'QuickBar',
      body: message
    }).show();
  }
}

// --- IPC Handlers ---

ipcMain.handle('save-note', async (event, text) => {
  return saveToNotes(text);
});

ipcMain.handle('dispatch-command', async (event, text) => {
  // Save command to notes (audit trail)
  saveToNotes(text);

  // POST to Hermes API — fire-and-forget, but check HTTP status
  const command = text.replace(/^\/do\s+/i, '').trim();
  const body = JSON.stringify({
    model: 'hermes-agent',
    messages: [{ role: 'user', content: command }],
    stream: false
  });

  try {
    const url = new URL(config.hermesApiUrl.replace(/\/$/, '') + '/chat/completions');

    return new Promise((resolve) => {
      const req = http.request({
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.hermesApiKey}`,
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true });
          } else {
            let errorMsg = `Hermes returned HTTP ${res.statusCode}`;
            try {
              const parsed = JSON.parse(data);
              if (parsed.error?.message) errorMsg = parsed.error.message;
            } catch (_) {}
            showErrorNotification(errorMsg);
            resolve({ ok: false, error: errorMsg });
          }
        });
      });

      req.on('error', (e) => {
        const msg = `Hermes unreachable: ${e.message}`;
        showErrorNotification(msg);
        resolve({ ok: false, error: msg });
      });

      req.write(body);
      req.end();
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.on('hide-window', () => {
  hideWindow();
});

// --- App Lifecycle ---

app.whenReady().then(() => {
  // Hide from dock — tray icon is the only presence
  if (process.platform === 'darwin') app.dock.hide();

  config = loadConfig();
  ensureNotesDir();
  createWindow();
  createTray();

  const registered = globalShortcut.register(config.hotkey, () => {
    if (mainWindow && mainWindow.isVisible()) {
      hideWindow();
    } else {
      showWindow();
    }
  });

  if (!registered) {
    console.error(`[QuickBar] Failed to register hotkey: ${config.hotkey}`);
    console.error('[QuickBar] Another app may be using it (e.g., Spotlight). Remap Spotlight in System Settings → Keyboard → Keyboard Shortcuts.');
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // Keep running — QuickBar lives in the background
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});