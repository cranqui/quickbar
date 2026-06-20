const { app, BrowserWindow, globalShortcut, ipcMain, Notification, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { loadConfig, ensureNotesDir, NOTES_DIR, readHermesEnvTelegram } = require('./config');
const os = require('os');

let mainWindow = null;
let config = null;
let tray = null;
let isQuitting = false;
let isContextMenuOpen = false;

// --- Tray Icon ---

function createTray() {
  // Idle: solid circle (template image — macOS auto-inverts for menu bar)
  const idlePath = path.join(__dirname, '..', 'assets', 'tray-icon-idle.png');
  let trayIcon;
  if (fs.existsSync(idlePath)) {
    trayIcon = nativeImage.createFromPath(idlePath).resize({ width: 16, height: 16 });
  } else {
    const iconBase64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAU0lEQVR4nGNgGKygFIjPAPFPKD4DFSMIlKGK/+PAZ6BqcAJ8mpENwelsQpphGKt3iLEdryt+kmDAT5oYQLEXKA5EYl2BMxpBgOKEhOwdspIy/AQC8Z5ha7UPWCsAAAAASUVORK5CYII=';
    trayIcon = nativeImage.createFromDataURL(`data:image/png;base64,${iconBase64}`).resize({ width: 16, height: 16 });
  }
  if (process.platform === 'darwin') trayIcon.setTemplateImage(true);

  tray = new Tray(trayIcon);
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
        shell.openPath(NOTES_DIR).then(errMsg => {
          if (errMsg) console.error('[QuickBar] openPath error:', errMsg);
        });
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

// --- Doer Inbox Helper (writes directly to Doer's SQLite DB) ---

const DOER_DB = path.join(os.homedir(), 'Library', 'Application Support', 'doer', 'tasks.db');

function addToDoerInbox(text) {
  const task = text.replace(/^\/do\s+/i, '').trim();
  if (!task) return { ok: false, error: 'Empty task' };

  const now = Date.now();
  const id = now.toString(36) + Math.random().toString(36).slice(2, 7);

  try {
    const Database = require('better-sqlite3');
    const dbPath = DOER_DB;

    if (!fs.existsSync(dbPath)) {
      return { ok: false, error: 'Doer database not found. Open Doer app first.' };
    }

    const db = new Database(dbPath, { readonly: false, fileMustExist: true });
    db.pragma('journal_mode = WAL');
    db.prepare(`
      INSERT INTO tasks (id, name, notes, bucket, cat, pri, status, createdAt, completedAt, delegatedTo, dueDate, tags, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, task, '', 'inbox', 'personal', 'normal', 'active', now, null, null, null, '', now);
    db.close();
  } catch (err) {
    console.error('Doer DB write failed:', err.message);
    return { ok: false, error: `DB error: ${err.message}` };
  }

  // Also log as note
  saveToNotes(text);

  // Notify
  if (Notification.isSupported()) {
    new Notification({ title: 'Doer', body: `Added to inbox: ${task}` }).show();
  }

  return { ok: true };
}

// --- Window ---

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 640,
    height: 104,  // 6px inset top+bottom + 58px input row + 32px status bar + 2px border = ~100, +4 headroom
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    show: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: true,
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
  const x = Math.round((screenWidth - 640) / 2);
  const y = Math.round(screenHeight * 0.3);
  mainWindow.setPosition(x, y);
}

function showWindow() {
  if (!mainWindow) return;
  positionWindow();
  try { mainWindow.webContents.send('clear-input'); } catch (_) {}
  // On macOS with dock hidden, the process is a background agent and won't
  // receive focus via show()/focus() alone — app.focus({ steal: true }) is
  // required to bring the window in front of the currently active app.
  if (process.platform === 'darwin') app.focus({ steal: true });
  mainWindow.show();
  mainWindow.focus();
}

function hideWindow() {
  if (!mainWindow) return;
  mainWindow.hide();
}

// --- Notifications ---

function showErrorNotification(message) {
  if (Notification.isSupported()) {
    new Notification({ title: 'QuickBar Error', body: String(message) }).show();
  }
}

// --- Telegram Delivery ---

function sendToTelegram(text) {
  const { botToken, chatId } = readHermesEnvTelegram();
  if (!botToken || !chatId) {
    console.error('[QuickBar] Telegram credentials not found in .env');
    return;
  }
  const message = `⚡ *QuickBar*\n${text}`;
  const body = JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' });
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${botToken}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        console.error('[QuickBar] Telegram send failed:', res.statusCode, data);
      }
    });
  });
  req.on('error', (e) => console.error('[QuickBar] Telegram send error:', e.message));
  req.write(body);
  req.end();
}

// --- IPC Handlers ---

ipcMain.handle('save-note', async (event, text) => {
  return saveToNotes(text);
});

ipcMain.handle('add-to-doer', async (event, text) => {
  return addToDoerInbox(text);
});

ipcMain.handle('dispatch-command', async (event, text) => {
  // Save command to notes (audit trail)
  saveToNotes(text);

  // POST to Hermes API — parse response, deliver via Telegram + Notification
  const command = text.replace(/^\/ai\s+/i, '').trim();
  const body = JSON.stringify({
    model: 'hermes-agent',
    messages: [
      { role: 'user', content: command }
    ],
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
            // Extract reply text from API response
            let reply = '';
            try {
              const parsed = JSON.parse(data);
              reply = parsed.choices?.[0]?.message?.content?.trim() || '';
            } catch (_) {}
            if (reply) {
              sendToTelegram(reply);
            }
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