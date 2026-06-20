// Window management handler — snap frontmost window to left/right/full.
// Uses Electron screen API for correct logical resolution.

const { screen } = require('electron');

function runAppleScript(script) {
  const { execFile } = require('child_process');
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout: 3000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, error: stderr || err.message });
      } else {
        resolve({ ok: true, output: stdout.trim() });
      }
    });
  });
}

async function windowManage(action) {
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  const W = Math.round(area.width);
  const H = Math.round(area.height);
  const X = Math.round(area.x);
  const Y = Math.round(area.y);

  let pos, size;
  if (action === 'left') {
    pos = `${X}, ${Y}`;
    size = `${Math.round(W / 2)}, ${H}`;
  } else if (action === 'right') {
    pos = `${X + Math.round(W / 2)}, ${Y}`;
    size = `${Math.round(W / 2)}, ${H}`;
  } else {
    pos = `${X}, ${Y}`;
    size = `${W}, ${H}`;
  }

  const script = `
    tell application "System Events"
      set p to first process whose frontmost is true
      set w to first window of p
      set position of w to {${pos}}
      set size of w to {${size}}
    end tell`;

  return runAppleScript(script);
}

function register(ipcMain) {
  ipcMain.handle('window-manage', async (event, action) => windowManage(action));
}

module.exports = { register, windowManage };