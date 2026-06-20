# QuickBar — Archived Response Features

_2026-04-29: Removed from main.js to simplify QuickBar as a pure launcher.  
Telegram is now the sole response surface. These features can be restored if needed._

---

## 1. Tray Icon State (working/idle swap)

Swaps the tray icon to a colored dot while waiting for the Hermes response, reverts on completion/error.

**Removed:**
- `idleTrayIcon` variable
- `setTrayIconWorking()` — switches to `tray-icon-working.png` (#DA7756 solid circle)
- `setTrayIconIdle()` — reverts to `tray-icon-idle.png` (template image, auto-inverts)
- `idleTrayIcon = trayIcon` assignment in `createTray()`
- `setTrayIconWorking()` call at dispatch start
- `setTrayIconIdle()` calls on res.end, req.error, catch

**Asset files (still in `src/assets/`):**
- `tray-icon-idle.png` — 16×16 solid black circle (template image)
- `tray-icon-working.png` — 16×16 solid #DA7756 circle

**Restore:** Add `idleTrayIcon`, `setTrayIconWorking()`, `setTrayIconIdle()` back, call at dispatch boundaries.

---

## 2. macOS Notification for Response

Shows the agent reply as a native macOS Notification (titled "Hermes") in addition to Telegram delivery.

**Removed:**
- `showNotification()` generic function
- `showNotification(reply.slice(0, 4000), 'Hermes')` in dispatch success handler
- `showErrorNotification()` still kept for error-only notifications
- `Notification` import from Electron (still needed for errors)

**Restore:** Add `showNotification()` back, call in success path alongside `sendToTelegram()`.

---

## 3. Direct Telegram Delivery via Bot API

Sends the agent response directly to Telegram via Bot API (`sendMessage`), reading token/chat_id from `~/.hermes/.env`.

**Removed:**
- `sendToTelegram(text)` function
- `https` require
- `readHermesEnvTelegram` import from config
- `sendToTelegram(reply)` call in dispatch success handler
- `readHermesEnvTelegram()` function in config.js
- Export of `readHermesEnvTelegram` from config.js

**Key code:**
```js
const https = require('https');

function sendToTelegram(text) {
  const { botToken, chatId } = readHermesEnvTelegram();
  if (!botToken || !chatId) return;
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
```

**Config.js addition:**
```js
function readHermesEnvTelegram() {
  if (!fs.existsSync(HERMES_ENV_FILE)) return { botToken: '', chatId: '' };
  try {
    const raw = fs.readFileSync(HERMES_ENV_FILE, 'utf8');
    const tokenMatch = raw.match(/^TELEGRAM_BOT_TOKEN=(.+)$/m);
    const chatMatch = raw.match(/^TELEGRAM_HOME_CHANNEL=(.+)$/m);
    return {
      botToken: tokenMatch ? tokenMatch[1].trim() : '',
      chatId: chatMatch ? chatMatch[1].trim() : ''
    };
  } catch (e) {
    return { botToken: '', chatId: '' };
  }
}
```

**Restore:** Add `https` require, import `readHermesEnvTelegram`, add both functions back, call `sendToTelegram(reply)` in dispatch success.

---

## 4. Response Parsing from API Response Body

Extracts `choices[0].message.content` from the Hermes API JSON to show/forward the reply.

**Removed:**
- JSON.parse + content extraction in success handler
- `data` accumulator for response body (still needed for error parsing)

**Restore:** Parse response body on success, extract reply text.