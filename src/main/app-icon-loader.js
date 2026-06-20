const { app, nativeImage } = require('electron');
const fs = require('fs');

// In-memory icon cache: appPath → dataURL
const iconCache = new Map();
const MAX_ICON_CACHE = 100;

/**
 * Get app icon via Electron's app.getFileIcon().
 * Uses macOS Launch Services internally — handles .app bundles correctly.
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

  let img = null;

  // Method 1: app.getFileIcon (Promise-based, Electron 28+)
  try {
    img = await app.getFileIcon(appPath, { size: 'normal' });
  } catch (e) {
    // Method 2: fallback to callback-based
    try {
      img = await new Promise((resolve, reject) => {
        app.getFileIcon(appPath, { size: 'normal' }, (err, image) => {
          if (err) reject(err);
          else resolve(image);
        });
      });
    } catch (e2) {
      // Method 3: nativeImage on .icns file (may work for some formats)
      // Not reliable but worth trying
    }
  }

  if (!img || img.isEmpty()) {
    return null;
  }

  // Resize to 32x32 retina (64px) for crisp display
  const resized = img.resize({ width: 64, height: 64 });
  const dataURL = resized.toDataURL();

  // Cache it
  if (iconCache.size >= MAX_ICON_CACHE) {
    const firstKey = iconCache.keys().next().value;
    iconCache.delete(firstKey);
  }
  iconCache.set(appPath, dataURL);

  return dataURL;
}

module.exports = { getIconDataURL };