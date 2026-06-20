const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const APP_DIRS = [
  '/Applications',
  '/System/Applications',
  '/Applications/Utilities',
  '/System/Applications/Utilities',
  path.join(os.homedir(), 'Applications'),
];

/**
 * Query Spotlight index for all app bundles.
 * This is what Raycast/Alfred use — same pre-built index.
 */
function queryMdfind() {
  return new Promise((resolve) => {
    execFile('mdfind', ['kMDItemContentType == "com.apple.application-bundle"'],
      { maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          console.error('[QuickBar] mdfind failed, falling back to dir scan:', err.message);
          return resolve(null);
        }
        const paths = stdout.trim().split('\n').filter(Boolean).filter(p => p.endsWith('.app'));
        resolve(paths);
      }
    );
  });
}

/**
 * Fallback: scan known Application directories.
 */
function scanAppDirectories() {
  const apps = [];
  for (const dir of APP_DIRS) {
    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (entry.endsWith('.app')) {
          apps.push(path.join(dir, entry));
        }
      }
    } catch { /* dir may not exist */ }
  }
  return apps;
}

/**
 * Parse Info.plist (XML format) for bundle ID and icon name.
 * We use regex — not a full plist parser — because we only need 2 keys
 * and Apple's plists are reliably formatted XML in .app bundles.
 */
function parseInfoPlist(appPath) {
  const plistPath = path.join(appPath, 'Contents/Info.plist');
  let bundleId = '';
  let iconName = '';

  try {
    const content = fs.readFileSync(plistPath, 'utf8');

    const idMatch = content.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/);
    if (idMatch) bundleId = idMatch[1];

    // CFBundleIconFile (older) or CFBundleIconName (modern, asset catalog)
    const iconMatch = content.match(/<key>CFBundleIcon(?:File|Name)<\/key>\s*<string>([^<]+)<\/string>/);
    if (iconMatch) iconName = iconMatch[1];
  } catch { /* not a valid app bundle */ }

  return { bundleId, iconName };
}

/**
 * Resolve the actual icon file path inside the .app bundle.
 * Tries: named icon (.icns/.png) → AppIcon.icns → icon.icns → icon.png
 */
function resolveIconPath(appPath, iconName) {
  const resourcesDir = path.join(appPath, 'Contents/Resources');

  const candidates = [];
  if (iconName) {
    // iconName may or may not include extension
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

  return null;
}

/**
 * Build the full app list with metadata.
 */
async function getInstalledApps() {
  let appPaths = await queryMdfind();

  if (!appPaths || appPaths.length === 0) {
    appPaths = scanAppDirectories();
  }

  // Merge with directory scan to catch any apps Spotlight missed
  const dirApps = scanAppDirectories();
  const allPaths = [...new Set([...appPaths, ...dirApps])];

  // Filter out helpers, updaters, internal bundles, and dev Electron instances
  const filtered = allPaths.filter(p => {
    const name = path.basename(p, '.app');

    // Skip anything inside /Library/ framework paths, HTTPStorages, Containers, etc.
    if (p.includes('/Library/') && !p.startsWith('/System/Applications/')) return false;
    if (p.includes('/Contents/')) return false;
    if (p.includes('/node_modules/')) return false; // dev Electron instances
    if (p.includes('/dist/mac-')) return false; // packaged but inside project dir

    // Skip helpers, updaters, uninstallers
    if (name.match(/(Helper|Uninstall|Updater|Crashpad)/i)) return false;

    // Skip system daemons/services — keep only user-facing apps
    const isUserApp = p.startsWith('/Applications/') ||
                      p.startsWith('/System/Applications/') ||
                      p.startsWith(path.join(os.homedir(), 'Applications/'));
    if (!isUserApp) return false;

    return true;
  });

  const apps = filtered.map(appPath => {
    const name = path.basename(appPath, '.app');
    const { bundleId, iconName } = parseInfoPlist(appPath);
    const iconPath = resolveIconPath(appPath, iconName);

    return {
      name,
      path: appPath,
      bundleId,
      iconPath,
    };
  });

  // Sort alphabetically
  apps.sort((a, b) => a.name.localeCompare(b.name));

  return apps;
}

module.exports = { getInstalledApps, APP_DIRS };