const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quickBarAPI', {
  saveNote: (text) => ipcRenderer.invoke('save-note', text),
  dispatchCommand: (text) => ipcRenderer.invoke('dispatch-command', text),
  addToDoer: (text) => ipcRenderer.invoke('add-to-doer', text),
  searchApps: (query) => ipcRenderer.invoke('search-apps', query),
  getAppIcon: (iconPath) => ipcRenderer.invoke('get-app-icon', iconPath),
  launchApp: (appPath) => ipcRenderer.invoke('launch-app', appPath),
  resizeWindow: (height) => ipcRenderer.invoke('resize-window', height),
  hideWindow: () => ipcRenderer.send('hide-window'),
  onClearInput: (callback) => {
    ipcRenderer.removeAllListeners('clear-input');
    ipcRenderer.on('clear-input', () => callback());
  }
});