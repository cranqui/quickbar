const { nativeImage } = require('electron');

// In-memory icon cache: appPath → dataURL
const iconCache = new Map();
const MAX_ICON_CACHE = 100; // Prevent unbounded memory growth

/**
 * Convert an .icns or .png icon file to a displayable data URL.
 * nativeImage can read .icns files directly — no conversion needed.
 */
function getIconDataURL(iconPath) {
  if (!iconPath) return null;

  // Check memory cache
  if (iconCache.has(iconPath)) {
    return iconCache.get(iconPath);
  }

  try {
    const img = nativeImage.createFromPath(iconPath);
    if (img.isEmpty()) return null;

    // Resize to 32x32 retina (64px) for crisp display
    const resized = img.resize({ width: 64, height: 64 });
    const dataURL = resized.toDataURL();

    // Cache it
    if (iconCache.size >= MAX_ICON_CACHE) {
      // Evict oldest entry (Map preserves insertion order)
      const firstKey = iconCache.keys().next().value;
      iconCache.delete(firstKey);
    }
    iconCache.set(iconPath, dataURL);

    return dataURL;
  } catch (e) {
    console.error('[QuickBar] Icon load failed:', iconPath, e.message);
    return null;
  }
}

/**
 * Batch load icons for a list of apps.
 * Returns a map: appPath → dataURL
 */
function loadIconsBatch(appPaths) {
  const result = {};
  for (const appPath of appPaths) {
    const iconPath = resolveIconPathFromApp(appPath);
    result[appPath] = getIconDataURL(iconPath);
  }
  return result;
}

/**
 * Resolve icon path from app path by reading Info.plist.
 * This is a fallback — normally the scanner already provides iconPath.
 */
function resolveIconPathFromApp(appPath) {
  // This is called when we only have the app path, not the full app object.
  // The scanner already resolved iconPath, so we expect it to be passed directly.
  // This function exists for the IPC handler where we only get the path.
  return appPath;
}

module.exports = { getIconDataURL };