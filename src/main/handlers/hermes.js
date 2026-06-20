// Hermes AI dispatch + Telegram delivery handler.

const http = require('http');
const https = require('https');
const { Notification } = require('electron');

const HERMES_TIMEOUT = 30000;

function sendToTelegram(text, readHermesEnvTelegram) {
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
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    timeout: HERMES_TIMEOUT,
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
  req.on('timeout', () => { req.destroy(); console.error('[QuickBar] Telegram send timeout'); });
  req.write(body);
  req.end();
}

function showErrorNotification(message) {
  if (Notification.isSupported()) {
    new Notification({ title: 'QuickBar Error', body: String(message) }).show();
  }
}

async function dispatchCommand(text, config, saveToNotes, readHermesEnvTelegram) {
  saveToNotes(text);

  const command = text.replace(/^\/ai\s+/i, '').trim();
  const body = JSON.stringify({
    model: 'hermes-agent',
    messages: [{ role: 'user', content: command }],
    stream: false,
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
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: HERMES_TIMEOUT,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            let reply = '';
            try {
              const parsed = JSON.parse(data);
              reply = parsed.choices?.[0]?.message?.content?.trim() || '';
            } catch {}
            if (reply) sendToTelegram(reply, readHermesEnvTelegram);
            resolve({ ok: true });
          } else {
            let errorMsg = `Hermes returned HTTP ${res.statusCode}`;
            try {
              const parsed = JSON.parse(data);
              if (parsed.error?.message) errorMsg = parsed.error.message;
            } catch {}
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

      req.on('timeout', () => {
        req.destroy();
        showErrorNotification('Hermes API timeout');
        resolve({ ok: false, error: 'Hermes API timeout' });
      });

      req.write(body);
      req.end();
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function register(ipcMain, deps) {
  ipcMain.handle('dispatch-command', async (event, text) => {
    return dispatchCommand(text, deps.config, deps.saveToNotes, deps.readHermesEnvTelegram);
  });
}

module.exports = { register, dispatchCommand };