const fs = require('fs');
const path = require('path');
const os = require('os');
const { getInstalledApps, APP_DIRS } = require('./app-scanner');

const CACHE_FILE = path.join(os.homedir(), '.quickbar', 'app-cache.json');
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let appCache = null;
let lastRefresh = 0;
let refreshPromise = null;
let watchers = [];

/**
 * Load cache from disk (fast cold start).
 */
function loadDiskCache() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed.timestamp && Date.now() - parsed.timestamp < CACHE_TTL) {
      return parsed.apps;
    }
  } catch {}
  return null;
}

/**
 * Persist cache to disk.
 */
function saveDiskCache(apps) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ timestamp: Date.now(), apps }), 'utf8');
  } catch (e) {
    console.error('[QuickBar] Failed to save app cache:', e.message);
  }
}

/**
 * Get cached app list. Returns immediately from memory/disk cache,
 * refreshes in background if stale.
 */
async function getCachedApps() {
  // Hot memory cache
  if (appCache && Date.now() - lastRefresh < CACHE_TTL) {
    return appCache;
  }

  // Warm disk cache — return immediately, refresh in background
  if (!appCache) {
    const diskApps = loadDiskCache();
    if (diskApps) {
      appCache = diskApps;
      lastRefresh = Date.now();
      // Background refresh — don't await
      refreshInBackground();
      return appCache;
    }
  }

  // Cold start — must wait for first scan
  if (refreshPromise) return refreshPromise;
  return refreshInBackground();
}

function refreshInBackground() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const apps = await getInstalledApps();
      appCache = apps;
      lastRefresh = Date.now();
      saveDiskCache(apps);
      return apps;
    } catch (e) {
      console.error('[QuickBar] App scan failed:', e.message);
      return appCache || [];
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Watch /Applications for changes — invalidate cache on add/remove.
 */
function startAppWatchers() {
  // Clean up existing watchers
  for (const w of watchers) {
    try { w.close(); } catch {}
  }
  watchers = [];

  let debounceTimer = null;

  for (const dir of APP_DIRS) {
    try {
      if (!fs.existsSync(dir)) continue;
      const watcher = fs.watch(dir, (eventType, filename) => {
        if (filename && filename.endsWith('.app')) {
          // Debounce — coalesce rapid changes
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            console.log('[QuickBar] App directory changed, invalidating cache');
            appCache = null;
            lastRefresh = 0;
          }, 2000);
        }
      });
      watchers.push(watcher);
    } catch {}
  }
}

/**
 * Synchronous access to cached apps (for use in non-async contexts like getRunningProcesses).
 * Returns memory cache or disk cache, never triggers a scan.
 */
function getCachedAppsSync() {
  if (appCache) return appCache;
  return loadDiskCache() || [];
}

module.exports = { getCachedApps, startAppWatchers, getCachedAppsSync };