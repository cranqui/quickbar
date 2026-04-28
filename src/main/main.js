const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { loadConfig, ensureNotesDir, NOTES_DIR } = require('./config');

let mainWindow = null;
let config = null;

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
      sandbox: false,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Center window horizontally, 30% from top
  mainWindow.once('ready-to-show', () => {
    positionWindow();
    // Show on launch for initial testing — remove after verification
    showWindow();
  });

  // Hide on blur (click outside)
  mainWindow.on('blur', () => {
    if (mainWindow.isVisible()) {
      hideWindow();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
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

// --- IPC Handlers ---

ipcMain.handle('save-note', async (event, text) => {
  try {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = now.toISOString().replace('T', ' ').substring(0, 16); // YYYY-MM-DD HH:mm
    const filePath = path.join(NOTES_DIR, `${dateStr}.txt`);
    const line = `[${timeStr}] ${text}\n`;
    fs.appendFileSync(filePath, line, 'utf8');
    return { ok: true };
  } catch (e) {
    console.error('[QuickBar] Failed to save note:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('dispatch-command', async (event, text) => {
  // First, save the command to notes (audit trail)
  try {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toISOString().replace('T', ' ').substring(0, 16);
    const filePath = path.join(NOTES_DIR, `${dateStr}.txt`);
    const line = `[${timeStr}] ${text}\n`;
    fs.appendFileSync(filePath, line, 'utf8');
  } catch (e) {
    // Note save failure is non-fatal — the dispatch is more important
    console.error('[QuickBar] Failed to log command to notes:', e.message);
  }

  // POST to Hermes API (fire-and-forget, but check status)
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
            // Success — Hermes will deliver to Telegram
            resolve({ ok: true });
          } else {
            // Non-2xx: notify renderer
            let errorMsg = `Hermes returned HTTP ${res.statusCode}`;
            try {
              const parsed = JSON.parse(data);
              if (parsed.error?.message) errorMsg = parsed.error.message;
            } catch (_) {}
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('dispatch-status', {
                ok: false,
                status: res.statusCode,
                message: errorMsg
              });
            }
            resolve({ ok: false, error: errorMsg });
          }
        });
      });

      req.on('error', (e) => {
        const msg = `Hermes unreachable: ${e.message}`;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('dispatch-status', {
            ok: false,
            status: 0,
            message: msg
          });
        }
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
  config = loadConfig();
  ensureNotesDir();
  createWindow();

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

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // Keep running — QuickBar lives in the background
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});