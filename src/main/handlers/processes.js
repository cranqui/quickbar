// Process listing + killing handler.
// Uses async execFile (no blocking), caches app lookup for icons.

const { execFile } = require('child_process');
const path = require('path');

function getRunningProcesses() {
  return new Promise((resolve) => {
    execFile('ps', ['-eo', 'pid=,rss=,comm='], { encoding: 'utf8', timeout: 2000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve([]);

      // Build app lookup from cache (sync — already in memory)
      let appLookup = {};
      try {
        const { getCachedAppsSync } = require('../app-cache');
        const apps = getCachedAppsSync();
        for (const app of apps) {
          appLookup[app.name.toLowerCase()] = app.path;
        }
      } catch {}

      const procs = [];
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const m = trimmed.match(/^(\d+)\s+(\d+)\s+(.+)$/);
        if (!m) continue;
        const pid = parseInt(m[1]);
        const rssKB = parseInt(m[2]);
        const comm = m[3].trim();
        if (pid === 0) continue;
        if (comm.includes('QuickBar') || comm.includes('Electron Helper')) continue;

        const name = comm.split('/').pop();
        const nameLower = name.toLowerCase();

        let appPath = null;
        let isMainApp = false;

        if (appLookup[nameLower]) {
          appPath = appLookup[nameLower];
          isMainApp = true;
        } else {
          const baseName = nameLower.replace(/\s+(helper|helper.*|renderer|gpu|crashpad|notification|plugin)/i, '').trim();
          if (baseName && appLookup[baseName]) {
            appPath = appLookup[baseName];
          }
        }

        procs.push({
          pid,
          name,
          comm,
          memory: rssKB > 1024 ? `${(rssKB / 1024).toFixed(0)} MB` : `${rssKB} KB`,
          memoryMB: Math.round(rssKB / 1024),
          appPath,
          isMainApp,
        });
      }
      resolve(procs);
    });
  });
}

async function listProcesses() {
  try {
    const procs = await getRunningProcesses();
    procs.sort((a, b) => {
      if (a.isMainApp !== b.isMainApp) return a.isMainApp ? -1 : 1;
      return b.memoryMB - a.memoryMB;
    });
    return procs.slice(0, 30);
  } catch (e) {
    return { error: e.message };
  }
}

async function killProcess(pid) {
  try {
    process.kill(pid, 'SIGTERM');
    return { ok: true };
  } catch (e) {
    // Only try SIGKILL if process not found (ESRCH).
    // For EPERM (permission denied) or other errors, return the error.
    if (e.code === 'ESRCH') {
      try {
        process.kill(pid, 'SIGKILL');
        return { ok: true };
      } catch (e2) {
        return { ok: false, error: e2.message };
      }
    }
    return { ok: false, error: e.message };
  }
}

function register(ipcMain) {
  ipcMain.handle('list-processes', async () => listProcesses());
  ipcMain.handle('kill-process', async (event, pid) => killProcess(pid));
}

module.exports = { register, listProcesses, killProcess };