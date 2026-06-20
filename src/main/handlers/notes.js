// Notes + Doer inbox handler.
// Notes: append to ~/.quickbar/notes/YYYY-MM-DD.txt
// Doer: write to SQLite inbox (persistent connection singleton)

const fs = require('fs');
const path = require('path');
const os = require('os');
const { Notification } = require('electron');
const { NOTES_DIR } = require('../config');

const DOER_DB = path.join(os.homedir(), 'Library', 'Application Support', 'doer', 'tasks.db');

// Persistent DB connection singleton
let dbInstance = null;

function getDb() {
  if (dbInstance) return dbInstance;
  try {
    const Database = require('better-sqlite3');
    if (!fs.existsSync(DOER_DB)) return null;
    dbInstance = new Database(DOER_DB, { readonly: false, fileMustExist: true });
    dbInstance.pragma('journal_mode = WAL');
    return dbInstance;
  } catch (e) {
    console.error('[QuickBar] Doer DB init failed:', e.message);
    return null;
  }
}

function closeDb() {
  if (dbInstance) {
    try { dbInstance.close(); } catch {}
    dbInstance = null;
  }
}

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

function addToDoerInbox(text) {
  const task = text.replace(/^\/do\s+/i, '').trim();
  if (!task) return { ok: false, error: 'Empty task' };

  const now = Date.now();
  const id = now.toString(36) + Math.random().toString(36).slice(2, 7);

  const db = getDb();
  if (!db) {
    return { ok: false, error: 'Doer database not found. Open Doer app first.' };
  }

  try {
    db.prepare(`
      INSERT INTO tasks (id, name, notes, bucket, cat, pri, status, createdAt, completedAt, delegatedTo, dueDate, tags, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, task, '', 'inbox', 'personal', 'normal', 'active', now, null, null, null, '', now);
  } catch (err) {
    console.error('Doer DB write failed:', err.message);
    return { ok: false, error: `DB error: ${err.message}` };
  }

  saveToNotes(text);

  if (Notification.isSupported()) {
    new Notification({ title: 'Doer', body: `Added to inbox: ${task}` }).show();
  }

  return { ok: true };
}

function register(ipcMain) {
  ipcMain.handle('save-note', async (event, text) => saveToNotes(text));
  ipcMain.handle('add-to-doer', async (event, text) => addToDoerInbox(text));
}

module.exports = { register, saveToNotes, addToDoerInbox, closeDb };