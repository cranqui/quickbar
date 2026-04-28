const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quickBarAPI', {
  saveNote: (text) => ipcRenderer.invoke('save-note', text),
  dispatchCommand: (text) => ipcRenderer.invoke('dispatch-command', text),
  hideWindow: () => ipcRenderer.send('hide-window'),
  onClearInput: (callback) => {
    ipcRenderer.on('clear-input', () => callback());
  },
  onDispatchStatus: (callback) => {
    ipcRenderer.on('dispatch-status', (_event, data) => callback(data));
  }
});