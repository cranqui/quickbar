// Calculator handler — safe math evaluation via Function() with whitelist sanitization.

function evalMath(expr) {
  const cleaned = expr.replace(/\s+/g, '').replace(/[^0-9+\-*/().%^]/g, '');
  if (!cleaned || !cleaned.match(/^[0-9+\-*/().%^]+$/)) return null;
  // Replace ^ with ** for power operator
  const normalized = cleaned.replace(/\^/g, '**');
  try {
    const result = Function('"use strict"; return (' + normalized + ')')();
    if (typeof result === 'number' && isFinite(result)) {
      return Math.round(result * 1e10) / 1e10;
    }
    return null;
  } catch {
    return null;
  }
}

function register(ipcMain) {
  ipcMain.handle('calc', async (event, expr) => {
    return evalMath(expr);
  });
}

module.exports = { register, evalMath };