// App search + launch + icon loading handler.
// Icons: async sips conversion with in-memory cache.
// Search: fuzzysort + adaptive ranking by launch frequency.

const { shell } = require('electron');
const { nativeImage } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const fuzzysort = require('fuzzysort');
const { getCachedApps } = require('../app-cache');

const TMP_DIR = path.join(os.tmpdir(), 'quickbar-icons');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const iconCache = new Map();
const MAX_ICON_CACHE = 100;

// Launch stats — debounced writes
const LAUNCH_STATS_PATH = path.join(os.homedir(), '.quickbar', 'launch-stats.json');
let launchStats = {};
let launchStatsDirty = false;
let launchStatsTimer = null;

function loadLaunchStats() {
  try {
    launchStats = JSON.parse(fs.readFileSync(LAUNCH_STATS_PATH, 'utf8'));
  } catch {
    launchStats = {};
  }
}

function flushLaunchStats() {
  if (!launchStatsDirty) return;
  try {
    fs.writeFileSync(LAUNCH_STATS_PATH, JSON.stringify(launchStats, null, 2));
    launchStatsDirty = false;
  } catch (e) {
    console.error('[QuickBar] Failed to save launch stats:', e.message);
  }
}

function recordLaunch(appPath) {
  launchStats[appPath] = (launchStats[appPath] || 0) + 1;
  launchStatsDirty = true;
  // Debounce — flush at most every 5 seconds
  if (launchStatsTimer) clearTimeout(launchStatsTimer);
  launchStatsTimer = setTimeout(flushLaunchStats, 5000);
}

loadLaunchStats();

// --- Icon loading (async sips) ---

function resolveIcnsPath(appPath) {
  const plistPath = path.join(appPath, 'Contents/Info.plist');
  if (!fs.existsSync(plistPath)) return null;
  try {
    const content = fs.readFileSync(plistPath, 'utf8');
    const iconMatch = content.match(/<key>CFBundleIcon(?:File|Name)<\/key>\s*<string>([^<]+)<\/string>/);
    const iconName = iconMatch ? iconMatch[1] : 'AppIcon';
    const resourcesDir = path.join(appPath, 'Contents/Resources');
    const candidates = [];
    if (iconName) {
      if (iconName.endsWith('.icns') || iconName.endsWith('.png')) {
        candidates.push(iconName);
      } else {
        candidates.push(`${iconName}.icns`, `${iconName}.png`);
      }
    }
    candidates.push('AppIcon.icns', 'AppIcon.png', 'icon.icns', 'icon.png');
    for (const name of candidates) {
      const fullPath = path.join(resourcesDir, name);
      if (fs.existsSync(fullPath)) return fullPath;
    }
  } catch {}
  return null;
}

function getIconDataURL(appPath) {
  if (!appPath) return Promise.resolve(null);
  if (iconCache.has(appPath)) return Promise.resolve(iconCache.get(appPath));

  const icnsPath = resolveIcnsPath(appPath);
  if (!icnsPath) return Promise.resolve(null);

  const hash = require('crypto').createHash('md5').update(appPath).digest('hex').slice(0, 8);
  const pngPath = path.join(TMP_DIR, `${hash}.png`);

  return new Promise((resolve) => {
    execFile('sips', ['-s', 'format', 'png', icnsPath, '--out', pngPath, '--resampleWidth', '64'],
      { stdio: 'pipe', timeout: 5000 },
      (err) => {
        if (err || !fs.existsSync(pngPath)) return resolve(null);
        try {
          const img = nativeImage.createFromPath(pngPath);
          if (img.isEmpty()) {
            try { fs.unlinkSync(pngPath); } catch {}
            return resolve(null);
          }
          const dataURL = img.toDataURL();
          if (iconCache.size >= MAX_ICON_CACHE) {
            const firstKey = iconCache.keys().next().value;
            iconCache.delete(firstKey);
          }
          iconCache.set(appPath, dataURL);
          try { fs.unlinkSync(pngPath); } catch {}
          resolve(dataURL);
        } catch {
          try { fs.unlinkSync(pngPath); } catch {}
          resolve(null);
        }
      }
    );
  });
}

// --- Search ---

async function searchApps(query) {
  const apps = await getCachedApps();

  if (!query || query.length < 1) {
    const sorted = apps.slice().sort((a, b) => {
      const aCount = launchStats[a.path] || 0;
      const bCount = launchStats[b.path] || 0;
      if (aCount !== bCount) return bCount - aCount;
      return a.name.localeCompare(b.name);
    });
    return sorted.slice(0, 8).map(app => ({
      name: app.name, path: app.path, bundleId: app.bundleId, iconPath: app.iconPath,
    }));
  }

  const results = fuzzysort.go(query, apps, {
    keys: ['name'], threshold: -10000, limit: 20,
  });

  const reranked = results.map(r => {
    const count = launchStats[r.obj.path] || 0;
    return { r, score: r.score + count * 50 };
  }).sort((a, b) => b.score - a.score);

  return reranked.slice(0, 8).map(({ r }) => ({
    name: r.obj.name, path: r.obj.path, bundleId: r.obj.bundleId, iconPath: r.obj.iconPath,
  }));
}

async function launchApp(appPath) {
  try {
    await shell.openPath(appPath);
    recordLaunch(appPath);
    return { ok: true };
  } catch (err) {
    console.error('[QuickBar] Launch failed:', err.message);
    return { ok: false, error: err.message };
  }
}

function register(ipcMain) {
  ipcMain.handle('search-apps', async (event, query) => searchApps(query));
  ipcMain.handle('get-app-icon', async (event, appPath) => getIconDataURL(appPath));
  ipcMain.handle('launch-app', async (event, appPath) => launchApp(appPath));
}

module.exports = { register, searchApps, getIconDataURL, launchApp, flushLaunchStats };