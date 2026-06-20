const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quickBarAPI', {
  saveNote: (text) => ipcRenderer.invoke('save-note', text),
  dispatchCommand: (text) => ipcRenderer.invoke('dispatch-command', text),
  addToDoer: (text) => ipcRenderer.invoke('add-to-doer', text),
  hideWindow: () => ipcRenderer.send('hide-window'),
  onClearInput: (callback) => {
    ipcRenderer.removeAllListeners('clear-input');
    ipcRenderer.on('clear-input', () => callback());
  }
});