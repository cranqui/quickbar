const { app, BrowserWindow, globalShortcut, ipcMain, Notification, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { loadConfig, ensureNotesDir, NOTES_DIR, readHermesEnvTelegram } = require('./config');
const { getCachedApps, startAppWatchers } = require('./app-cache');
const { getIconDataURL } = require('./app-icon-loader');
const fuzzysort = require('fuzzysort');
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

// --- App Launcher IPC ---

ipcMain.handle('search-apps', async (event, query) => {
  const apps = await getCachedApps();

  if (!query || query.length < 1) {
    // Return first 8 apps alphabetically when no query
    return apps.slice(0, 8).map(app => ({
      name: app.name,
      path: app.path,
      bundleId: app.bundleId,
      iconPath: app.iconPath,
    }));
  }

  const results = fuzzysort.go(query, apps, {
    keys: ['name'],
    threshold: -10000,
    limit: 8,
  });

  return results.map(r => ({
    name: r.obj.name,
    path: r.obj.path,
    bundleId: r.obj.bundleId,
    iconPath: r.obj.iconPath,
  }));
});

ipcMain.handle('get-app-icon', async (event, appPath) => {
  if (!appPath) return null;
  return getIconDataURL(appPath);
});

ipcMain.handle('launch-app', async (event, appPath) => {
  try {
    await shell.openPath(appPath);
    return { ok: true };
  } catch (err) {
    console.error('[QuickBar] Launch failed:', err.message);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('resize-window', async (event, height) => {
  if (!mainWindow) return;
  const { width } = mainWindow.getBounds();
  mainWindow.setBounds({ width, height: Math.round(height) });
});

// --- Calculator IPC ---

// Safe math evaluator — no eval(), only numbers and operators
function evalMath(expr) {
  // Allow only digits, operators, parentheses, decimal points, spaces
  const cleaned = expr.replace(/\s+/g, '').replace(/[^0-9+\-*/().%]/g, '');
  if (!cleaned || !cleaned.match(/^[0-9+\-*/().%]+$/)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const result = Function('"use strict"; return (' + cleaned + ')')();
    if (typeof result === 'number' && isFinite(result)) {
      // Round to avoid floating point noise
      return Math.round(result * 1e10) / 1e10;
    }
    return null;
  } catch {
    return null;
  }
}

ipcMain.handle('calc', async (event, expr) => {
  return evalMath(expr);
});

// --- Window Management IPC ---

function runAppleScript(script) {
  return new Promise((resolve) => {
    const { execFile } = require('child_process');
    execFile('osascript', ['-e', script], { timeout: 3000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, error: stderr || err.message });
      } else {
        resolve({ ok: true, output: stdout.trim() });
      }
    });
  });
}

ipcMain.handle('window-manage', async (event, action) => {
  // Get frontmost app window and snap it
  const scripts = {
    left: `tell application "System Events" to set position of (first window of (first process whose frontmost is true)) to {0, 0}
tell application "System Events" to set size of (first window of (first process whose frontmost is true)) to {(word 3 of (do shell script "system_profiler SPDisplaysDataType | grep Resolution")) / 2, (word 4 of (do shell script "system_profiler SPDisplaysDataType | grep Resolution"))}`,
    right: `tell application "System Events" to set position of (first window of (first process whose frontmost is true)) to {(word 3 of (do shell script "system_profiler SPDisplaysDataType | grep Resolution")) / 2, 0}
tell application "System Events" to set size of (first window of (first process whose frontmost is true)) to {(word 3 of (do shell script "system_profiler SPDisplaysDataType | grep Resolution")) / 2, (word 4 of (do shell script "system_profiler SPDisplaysDataType | grep Resolution"))}`,
    full: `tell application "System Events" to set position of (first window of (first process whose frontmost is true)) to {0, 0}
tell application "System Events" to set size of (first window of (first process whose frontmost is true)) to {(word 3 of (do shell script "system_profiler SPDisplaysDataType | grep Resolution")), (word 4 of (do shell script "system_profiler SPDisplaysDataType | grep Resolution"))}`,
  };

  // Simpler, more reliable approach: use keyboard shortcuts via macOS
  // Rectangle/Raycast use: Ctrl+Opt+Left/Right/Enter
  // But we don't have Rectangle guaranteed. Use AppleScript with screen bounds.
  const script = `
    tell application "System Events"
      set p to first process whose frontmost is true
      set w to first window of p
      set screenW to do shell script "system_profiler SPDisplaysDataType | awk '/Resolution/{print $2; exit}'"
      set screenH to do shell script "system_profiler SPDisplaysDataType | awk '/Resolution/{print $4; exit}'"
      set screenW to screenW as integer
      set screenH to screenH as integer
      ${action === 'left' ? `
      set position of w to {0, 0}
      set size of w to {screenW / 2, screenH}` : ''}
      ${action === 'right' ? `
      set position of w to {screenW / 2, 0}
      set size of w to {screenW / 2, screenH}` : ''}
      ${action === 'full' ? `
      set position of w to {0, 0}
      set size of w to {screenW, screenH}` : ''}
    end tell`;

  return runAppleScript(script);
});

// --- Currency Conversion IPC ---

const FX_CACHE = { rates: null, timestamp: 0 };
const FX_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

async function getFxRates() {
  if (FX_CACHE.rates && Date.now() - FX_CACHE.timestamp < FX_CACHE_TTL) {
    return FX_CACHE.rates;
  }

  return new Promise((resolve) => {
    const url = 'https://api.exchangerate-api.com/v4/latest/USD';
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          FX_CACHE.rates = parsed.rates;
          FX_CACHE.timestamp = Date.now();
          resolve(parsed.rates);
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

// Currency code aliases
const FX_ALIASES = {
  cop: 'COP', usd: 'USD', eur: 'EUR', gbp: 'GBP', jpy: 'JPY',
  cad: 'CAD', aud: 'AUD', chf: 'CHF', cny: 'CNY', mxn: 'MXN',
  brl: 'BRL', ars: 'ARS', clp: 'CLP', pen: 'PEN', cop: 'COP',
};

ipcMain.handle('convert-currency', async (event, amount, fromCur, toCur) => {
  const from = (fromCur || '').toUpperCase();
  const to = (toCur || '').toUpperCase();
  const amt = parseFloat(amount);
  if (isNaN(amt)) return { ok: false, error: 'Invalid amount' };

  const rates = await getFxRates();
  if (!rates) return { ok: false, error: 'FX API unreachable' };

  if (!rates[from]) return { ok: false, error: `Unknown currency: ${from}` };
  if (!rates[to]) return { ok: false, error: `Unknown currency: ${to}` };

  // Rates are relative to USD: amount_in_usd = amount / rate[from], then rate[to] * amount_in_usd
  const usdAmount = amt / rates[from];
  const result = usdAmount * rates[to];

  return {
    ok: true,
    result: Math.round(result * 100) / 100,
    from, to, amount: amt,
  };
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
  startAppWatchers();

  // Pre-warm app cache in background on launch
  getCachedApps().then(apps => {
    console.log(`[QuickBar] App cache ready: ${apps.length} apps`);
  }).catch(e => {
    console.error('[QuickBar] App cache init failed:', e.message);
  });

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