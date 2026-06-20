# QuickBar — Audit & Debug Findings
_2026-04-29_

---

## 1. Electron Upgrade (34 → 41)

**Issue:** `npm audit` flagged 18 CVEs against Electron ≤39.8.4.

**Triage:** All 18 CVEs were mapped against QuickBar's API surface. None are reachable in the current codebase — the affected APIs (service workers, offscreen rendering, USB, custom protocol handlers, `window.open`, PowerMonitor, etc.) are not used. The ASAR integrity bypass CVE becomes relevant at distribution time when packaging with `electron-builder`.

**Action:** Upgraded to Electron 41.3.0 (`npm audit fix --force`). Low urgency for a local-only tool, but staying current reduces future upgrade pain.

---

## 2. Breaking Change: `tray.setIgnoreDoubleClick()` Removed

**File:** `src/main/main.js:31`

**Error:**
```
TypeError: tray.setIgnoreDoubleClick is not a function
```

**Cause:** `Tray.setIgnoreDoubleClick()` was removed in Electron 37. QuickBar only handles `click` and `right-click` tray events — no `double-click` listener exists — so the call had no functional purpose.

**Fix:** Removed the line. No behavioral change.

---

## 3. Window Never Appearing (Hotkey + Tray Click Both Silent)

Two independent causes, same symptom.

### 3a. ⌘Space intercepted by Spotlight

**File:** `src/main/main.js` — `globalShortcut.register`

macOS claims ⌘Space for Spotlight before any app can register it. `globalShortcut.register` fails silently (logs to console only). The shortcut never fires.

**Fix:** Disable Spotlight's shortcut in System Settings → Keyboard → Keyboard Shortcuts → Spotlight → uncheck "Show Spotlight search". Or change the hotkey in `~/.quickbar/config.json`:
```json
"hotkey": "CommandOrControl+Shift+Space"
```

### 3b. `app.focus({ steal: true })` required on macOS

**File:** `src/main/main.js` — `showWindow()`

When `app.dock.hide()` is set, the process runs as a background agent. macOS will not let `mainWindow.show()` + `mainWindow.focus()` steal focus from the frontmost app without an explicit `app.focus({ steal: true })` call. Both the tray click and the hotkey share the same `showWindow()` path, so both were affected.

**Fix applied:**
```js
function showWindow() {
  if (!mainWindow) return;
  positionWindow();
  mainWindow.webContents.send('clear-input');
  if (process.platform === 'darwin') app.focus({ steal: true });
  mainWindow.show();
  mainWindow.focus();
}
```

---

## 4. Functional Verification

After fixes, both core flows confirmed working:

| Flow | Result |
|---|---|
| Plain text → Enter | Saved to `~/.quickbar/notes/2026-04-29.txt` ✅ |
| `/do <command>` → Enter | Logged to notes file + POSTed to Hermes ✅ |
| Hermes API (localhost:8642) | Running, accepts `change-me-local-dev` key, responds ✅ |
| Hermes → Telegram delivery | Not confirmed — Telegram integration is a Hermes configuration concern, outside QuickBar's scope ⬜ |

---

## 5. Code Audit Items — All Resolved

All issues from the earlier security/correctness audit are now addressed:

| # | Severity | File | Issue | Status | Fix Commit |
|---|----------|------|-------|--------|-------------|
| 1 | Medium | `index.html` | No Content-Security-Policy header | ✅ Fixed | `7b8ab79` — CSP meta tag added |
| 2 | Low | `config.js` | `~/.quickbar` dir without chmod 700 | ✅ Fixed | `7b8ab79` — `chmodSync(CONFIG_DIR, 0o700)` in `ensureDirs()` |
| 3 | Low | `preload.js` | IPC listener accumulation | ✅ Fixed | `01eca6f` — `removeAllListeners` before `on` |
| 4 | Low | `index.html` | Google Fonts loaded over network | ✅ Fixed | Already removed — no external font links in codebase |
| 5 | Low | `package.json` | `ws` dead dependency | ✅ Fixed | Already removed — not in package.json |
| 6 | Low | `index.html` | No dark mode support | ✅ Fixed | `bd2cebc` — `@media (prefers-color-scheme: dark)` block added |

---

## 6. How to Quit

Since the app has no dock icon: **right-click the tray icon → Quit QuickBar**.

From terminal: `pkill -f "electron ."`
