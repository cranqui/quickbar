# QuickBar — Project Briefing & Build Plan

## 1. What We're Building

**QuickBar** is a macOS menu-bar utility that provides a single global hotkey → floating input bar. It does exactly two things:

1. **Note** — Type anything, press Enter. Auto-saved as a timestamped line in a daily text file. Bar disappears.
2. **/do** — Type `/do <command>`, press Enter. Dispatches the command to the Hermes Agent API server. The response arrives in the existing Telegram conversation. Bar disappears.

That's it. No response panel, no conversation UI, no settings screen, no file manager. The bar is a **launcher**, not a chat window.

---

## 2. Why This Exists

- **Capture friction kills habits.** Opening a notes app, finding the right file, typing, saving — each step is a probability of abandonment. QuickBar: ⌘Space → type → Enter → gone.
- **Hermes is powerful but invisible.** It runs 24/7, triages email, tracks FX, manages Notion — but invoking it means switching to Telegram and typing a message. QuickBar: ⌘Space → `/do remind me Friday` → Enter → done.
- **Telegram is the conversation layer.** Responses from `/do` already land where you're looking. No need for a second UI.

---

## 3. Architecture Decisions

### 3.1 Stack (reuse Gabo skeleton)

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Electron 34 | Proven with Gabo, globalShortcut API, native macOS integration |
| Build | esbuild (IIFE) | Same pattern as Gabo — CM6 is gone but esbuild stays for consistency |
| Security | contextIsolation + preload bridge | Same IPC bridge pattern as Gabo |
| API | Hermes OpenAI-compatible API server | Already running at `localhost:8642`, Bearer auth, streaming SSE |

### 3.2 Design Principles

- **Input-only UI** — No response rendering, no chat history, no threading
- **Disappear on action** — Enter or Esc hides the bar. No lingering state.
- **Default = note** — Lowest cognitive load. If you start typing without `/do`, it's a note. Always.
- **Telegram is the reply channel** — `/do` responses land in the Hermes Telegram chat. This is a feature, not a limitation.
- **Zero configuration** — Hermes API URL and key read from `~/.hermes/.env`. No settings UI.

---

## 4. Data Model

### 4.1 Notes

**Storage**: `~/.quickbar/notes/YYYY-MM-DD.txt`

**Format** (append-only):
```
[2025-04-28 14:32] call Juan about Q2 budget
[2025-04-28 14:33] /do remind me to send receipts on Friday  ← also logged as a note
[2025-04-28 14:35] the new client pitch needs restructuring
```

- One file per day, auto-created on first note
- Both notes AND `/do` commands are logged (audit trail)
- Searchable via Spotlight, grep, or a future `/do search notes <query>`

### 4.2 Configuration

**File**: `~/.quickbar/config.json`

```json
{
  "hotkey": "CommandOrControl+Space",
  "hermesApiUrl": "http://localhost:8642/v1",
  "hermesApiKey": "change-me-local-dev",
  "notesDir": "~/.quickbar/notes"
}
```

Auto-created on first launch. If `hermesApiKey` is missing, reads from `~/.hermes/.env` (`API_SERVER_KEY`).

---

## 5. UX Specification

### 5.1 Visual

- **Width**: 600px, **Height**: single input line (~48px)
- **Position**: centered horizontally, ~30% from top of screen
- **Frame**: frameless, no titlebar, no resize handle
- **Always on top**: yes, but only while visible
- **Font**: Inter 16px, same as Gabo UI font
- **Caret**: blinking, auto-focused on show
- **Placeholder text**: "Note or /do <command>…" (dimmed)
- **Backdrop**: semi-transparent dark background with blur (like Spotlight)
- **Animation**: fade-in on show (150ms), fade-out on dismiss (100ms)

### 5.2 Interaction Flow

```
⌘Space
  → Window appears (hidden between uses, not destroyed)
  → Input focused, previous text cleared
  → Placeholder visible when empty

User types text (no /do prefix)
  → Enter pressed
  → Text saved to ~/.quickbar/notes/YYYY-MM-DD.txt
  → Window hides
  → Sound: subtle "pop" (optional, system default)

User types /do <command>
  → Enter pressed
  → Command logged to notes file (with /do prefix)
  → POST /v1/chat/completions sent to Hermes API
  → Window hides immediately (no wait for response)
  → Response arrives in Telegram via existing Hermes delivery

Escape
  → Window hides, text discarded
  → No save, no action

Click outside window
  → Same as Escape — hide, discard
```

### 5.3 Input Parsing Logic

```
if input starts with "/do " (case-insensitive):
    command = input.slice(4).trim()
    save to notes file (with /do prefix)
    POST to Hermes API: { model: "hermes-agent", messages: [{ role: "user", content: command }] }
    hide window
else:
    save to notes file
    hide window
```

Note: we don't need to wait for the Hermes response. The API call is fire-and-forget from QuickBar's perspective — Hermes handles delivery to Telegram.

---

## 6. Technical Design

### 6.1 IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `save-note` | renderer→main | Save text to daily notes file |
| `dispatch-command` | renderer→main | POST command to Hermes API |
| `dispatch-status` | main→renderer | Error feedback if API call fails (non-2xx or network error) |
| `show-window` | main→renderer | Window shown, clear input |

3 channels. No streaming, no response rendering.

### 6.2 Main Process (`main.js`)

```
app.whenReady()
  → createWindow({ frame: false, alwaysOnTop, show: false, width: 600, height: 48 })
  → registerGlobalShortcut('CommandOrControl+Space')
    → window.show(), webContents.focus()
  → ipcMain.handle('save-note', saveNoteToFile)
  → ipcMain.handle('dispatch-command', postToHermes)

saveNoteToFile(text)
  → ensure ~/.quickbar/notes/ exists
  → append "[YYYY-MM-DD HH:mm] {text}" to YYYY-MM-DD.txt
  → return { ok: true }

postToHermes(command)
  → POST http://localhost:8642/v1/chat/completions
  → Authorization: Bearer <key from config or .env>
  → Body: { model: "hermes-agent", messages: [{ role: "user", content: command }], stream: false }
  → Fire and forget (no response handling needed — Hermes delivers to Telegram)
  → return { ok: true } (always, unless network error)
```

### 6.3 Preload (`preload.js`)

```javascript
contextBridge.exposeInMainWorld('quickBarAPI', {
  saveNote: (text) => ipcRenderer.invoke('save-note', text),
  dispatchCommand: (text) => ipcRenderer.invoke('dispatch-command', text)
});
```

Two methods. That's it.

### 6.4 Renderer (`renderer.js`)

```javascript
const input = document.getElementById('quick-input');

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const text = input.value.trim();
    if (!text) return;
    if (text.toLowerCase().startsWith('/do ')) {
      quickBarAPI.dispatchCommand(text);
    } else {
      quickBarAPI.saveNote(text);
    }
    input.value = '';
    window.close(); // or ipcRenderer.send('hide-window')
  }
  if (e.key === 'Escape') {
    input.value = '';
    window.close();
  }
});

// Auto-focus on show
window.addEventListener('focus', () => input.focus());
```

~30 lines. No CM6, no bundle step needed. Plain JS.

### 6.5 Window Hiding Strategy

Don't destroy the window — hide it. This keeps the process alive and makes ⌘Space instant.

```javascript
mainWindow.on('blur', () => mainWindow.hide()); // click outside = hide
globalShortcut.register('CommandOrControl+Space', () => {
  mainWindow.webContents.send('clear-input');
  mainWindow.show();
  mainWindow.focus();
});
```

### 6.6 Hermes API Call (Non-streaming)

We use `stream: false` because we don't render the response — Hermes delivers it to Telegram. But **we do check the HTTP status** before discarding. A non-2xx response (Hermes running but rejecting the request) would otherwise be swallowed silently — you'd have a note saying "/do remind me Friday" with nothing dispatched and no indication.

```javascript
async function postToHermes(command) {
  const http = require('http');
  const body = JSON.stringify({
    model: 'hermes-agent',
    messages: [{ role: 'user', content: command }],
    stream: false
  });
  const req = http.request({
    hostname: 'localhost',
    port: 8642,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.hermesApiKey}`,
      'Content-Length': Buffer.byteLength(body)
    }
  }, (res) => {
    let data = '';
    res.on('d', (chunk) => data += chunk);
    res.on('end', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        // Non-2xx: show brief error so user knows dispatch failed
        mainWindow.webContents.send('dispatch-status', {
          ok: false,
          status: res.statusCode,
          message: `Hermes returned HTTP ${res.statusCode}`
        });
      }
    });
  });
  req.on('error', (e) => {
    // Network-level error (ECONNREFUSED, etc.)
    mainWindow.webContents.send('dispatch-status', {
      ok: false,
      status: 0,
      message: `Hermes unreachable: ${e.message}`
    });
  });
  req.write(body);
  req.end();
}
```

### 6.7 Config Loading

On startup, `main.js` reads `~/.quickbar/config.json`. If missing, creates with defaults. If `hermesApiKey` is empty or missing, falls back to parsing `~/.hermes/.env` for `API_SERVER_KEY`.

**Security note**: `~/.hermes/.env` is locked to 600 (Hermes audit). QuickBar reads it at startup with Node's `fs.readFileSync` — no shell expansion, no env injection. The key lives in QuickBar's process memory only (same threat model as the Hermes gateway itself, which also reads this file). QuickBar's own `config.json` should also be `chmod 600` on creation.

### 6.8 Menu Bar Icon (Optional Phase 2)

Phase 1: no menu bar icon, window is purely hotkey-activated.

Phase 2 (if desired): add a `Tray` icon in the menu bar — click to show the input bar, right-click for "Open notes folder" / "Quit".

---

## 7. Project Structure

```
quickbar/
├── src/
│   ├── main/
│   │   ├── main.js          # Electron main process, window, IPC, shortcuts, notes, API
│   │   └── config.js        # Config load/save, Hermes .env fallback
│   ├── renderer/
│   │   ├── preload.js       # contextBridge → quickBarAPI
│   │   ├── index.html       # Input bar UI + CSS (single file, no framework)
│   │   └── renderer.js      # Input handling, parse, dispatch (plain JS, no bundle)
│   └── assets/
│       └── icon.png          # App icon (256x256)
├── package.json
├── README.md
└── BRIEFING.md              # This file
```

**No esbuild step needed** — renderer.js is plain JS with no imports. No CM6, no frameworks, no modules. Just a `<script>` tag.

---

## 8. Build Plan

### Phase 1: Skeleton & Window (Day 1)

- [ ] Initialize Electron project (`npm init`, install `electron`)
- [ ] Create `main.js` with frameless, alwaysOnTop, centered window (600×48)
- [ ] Global shortcut registration (⌘Space show/hide toggle)
- [ ] Click-outside-to-hide behavior
- [ ] Basic `index.html` with centered input field + placeholder
- [ ] CSS: dark backdrop, Inter font, fade animations
- [ ] Verify: ⌘Space shows window, Esc/click-outside hides it, input auto-focuses

### Phase 2: Notes (Day 1)

- [ ] Implement `saveNoteToFile()` in main process
- [ ] Create `~/.quickbar/notes/` directory structure
- [ ] Append timestamped notes to `YYYY-MM-DD.txt`
- [ ] Wire renderer: Enter without `/do` → `quickBarAPI.saveNote(text)` → hide
- [ ] Verify: type "hello", Enter, check `~/.quickbar/notes/2025-04-28.txt`

### Phase 3: Hermes Dispatch (Day 2)

- [ ] Implement `config.js` — read/write `~/.quickbar/config.json`, fallback to `~/.hermes/.env`
- [ ] Implement `postToHermes()` — non-streaming POST to `/v1/chat/completions`
- [ ] Wire renderer: `/do <command>` → `quickBarAPI.dispatchCommand(text)` → hide
- [ ] Also log the `/do` command to the notes file (before API call)
- [ ] Verify: `/do what's the TRM today` → note saved → response arrives in Telegram

### Phase 4: Polish & Packaging (Day 2–3)

- [ ] Error handling: network error → brief inline status "⚠️ Hermes unreachable" (1.5s, then auto-hide)
- [ ] Input clearing on show (no leftover text from previous use)
- [ ] Window position: persist across sessions (or skip — re-centered is fine)
- [ ] App icon
- [ ] macOS signing & DMG packaging (`electron-builder` or `electron-forge`)
- [ ] Auto-launch on login (optional Phase 2)
- [ ] Menu bar Tray icon (optional Phase 2)

---

## 9. Open Questions

1. ~~**Hotkey conflict**~~ — **Resolved**: ⌘Space. Spotlight can be remapped in System Settings → Keyboard → Keyboard Shortcuts → Spotlight. Worth the muscle memory payoff.
2. ~~**Sound feedback**~~ — **Resolved**: Silent on note save. No sound.
3. **Note search** — Should `/do search notes <query>` grep the notes files? Or is Spotlight/grep enough for now?
4. ~~**Config UI**~~ — **Resolved**: Manual `config.json` editing is fine for Phase 1.
5. ~~**Menu bar icon**~~ — **Resolved**: Deferred to Phase 2.
6. ~~**Auto-launch**~~ — **Resolved**: Manual start for Phase 1.

**Remaining open**: Note search — defer to Phase 2 or build into `/do` dispatch logic?

---

## 10. What QuickBar Is NOT

- Not a chat client — no conversation threading, no response rendering
- Not a terminal — no command output, no shell access
- Not a full launcher — no app launching, no file search, no calculator
- Not a rich editor — no markdown, no formatting, no file management
- Not a replacement for Telegram — `/do` responses go there, not here

QuickBar is a **two-function muscle memory tool**: capture a thought, or dispatch an action. Everything else is scope creep.

---

## 11. Naming

**QuickBar** — clear, descriptive, forgettable (in a good way). It's a bar, it's quick.

Alternatives considered: Dispatch (too aggressive), Pulse (too trendy), Snap (too casual), Nimble (too cute). QuickBar says exactly what it does.