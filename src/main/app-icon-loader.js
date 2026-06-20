const { nativeImage } = require('electron');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TMP_DIR = path.join(os.tmpdir(), 'quickbar-icons');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// In-memory icon cache: appPath → dataURL
const iconCache = new Map();
const MAX_ICON_CACHE = 100;

/**
 * Get app icon by converting .icns → .png via sips, then reading with nativeImage.
 *
 * nativeImage.createFromPath cannot read .icns files.
 * app.getFileIcon returns generic placeholders.
 * sips (macOS built-in) converts .icns → .png reliably.
 *
 * @param {string} appPath - Path to the .app bundle
 * @returns {Promise<string|null>} - data URL or null
 */
async function getIconDataURL(appPath) {
  if (!appPath) return null;

  // Check memory cache
  if (iconCache.has(appPath)) {
    return iconCache.get(appPath);
  }

  // Resolve .icns path from app bundle
  const icnsPath = resolveIcnsPath(appPath);
  if (!icnsPath) {
    return null;
  }

  // Convert .icns → .png via sips
  const hash = require('crypto').createHash('md5').update(appPath).digest('hex').slice(0, 8);
  const pngPath = path.join(TMP_DIR, `${hash}.png`);

  try {
    execFileSync('sips', ['-s', 'format', 'png', icnsPath, '--out', pngPath, '--resampleWidth', '64'], {
      stdio: 'pipe',
      timeout: 5000,
    });
  } catch (e) {
    return null;
  }

  if (!fs.existsSync(pngPath)) {
    return null;
  }

  // Read the PNG with nativeImage
  try {
    const img = nativeImage.createFromPath(pngPath);
    if (img.isEmpty()) {
      fs.unlinkSync(pngPath);
      return null;
    }

    const dataURL = img.toDataURL();

    // Cache it
    if (iconCache.size >= MAX_ICON_CACHE) {
      const firstKey = iconCache.keys().next().value;
      iconCache.delete(firstKey);
    }
    iconCache.set(appPath, dataURL);

    // Clean up temp file
    fs.unlinkSync(pngPath);

    return dataURL;
  } catch (e) {
    try { fs.unlinkSync(pngPath); } catch {}
    return null;
  }
}

/**
 * Resolve the .icns file path from an .app bundle by reading Info.plist.
 */
function resolveIcnsPath(appPath) {
  const plistPath = path.join(appPath, 'Contents/Info.plist');
  if (!fs.existsSync(plistPath)) return null;

  try {
    const content = fs.readFileSync(plistPath, 'utf8');

    // Find CFBundleIconFile or CFBundleIconName
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

module.exports = { getIconDataURL };