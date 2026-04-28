const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.quickbar');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const NOTES_DIR = path.join(CONFIG_DIR, 'notes');
const HERMES_ENV_FILE = path.join(os.homedir(), '.hermes', '.env');

const DEFAULT_CONFIG = {
  hotkey: 'CommandOrControl+Space',
  hermesApiUrl: 'http://localhost:8642/v1',
  hermesApiKey: '',
  notesDir: NOTES_DIR
};

function loadConfig() {
  let config = { ...DEFAULT_CONFIG };

  // Try loading existing config
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      config = { ...DEFAULT_CONFIG, ...parsed };
    } catch (e) {
      console.error('[QuickBar] Failed to parse config.json:', e.message);
    }
  }

  // Fallback: if apiKey is empty, try to read from Hermes .env
  if (!config.hermesApiKey) {
    config.hermesApiKey = readHermesEnvKey();
  }

  return config;
}

function saveConfig(config) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    try { fs.chmodSync(CONFIG_DIR, 0o700); } catch (e) { /* non-fatal */ }
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  // chmod 600 for security (API key lives here)
  try { fs.chmodSync(CONFIG_FILE, 0o600); } catch (e) { /* non-fatal */ }
}

function readHermesEnvKey() {
  if (!fs.existsSync(HERMES_ENV_FILE)) return '';
  try {
    const raw = fs.readFileSync(HERMES_ENV_FILE, 'utf8');
    const match = raw.match(/^API_SERVER_KEY=(.+)$/m);
    return match ? match[1].trim() : '';
  } catch (e) {
    return '';
  }
}

function ensureDirs() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  try { fs.chmodSync(CONFIG_DIR, 0o700); } catch (e) { /* non-fatal */ }
  if (!fs.existsSync(NOTES_DIR)) {
    fs.mkdirSync(NOTES_DIR, { recursive: true });
  }
  // Ensure config file exists — but use loadConfig to resolve .env fallback first
  if (!fs.existsSync(CONFIG_FILE)) {
    const resolved = loadConfig(); // picks up .env fallback
    saveConfig(resolved);
  }
}

module.exports = { loadConfig, saveConfig, ensureNotesDir: ensureDirs, NOTES_DIR, CONFIG_DIR, CONFIG_FILE, HERMES_ENV_FILE };