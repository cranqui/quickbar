const { contextBridge, ipcRenderer } = require('electron');
const { ALL_CURRENCY_CODES_LOWER } = require('../main/constants');

contextBridge.exposeInMainWorld('quickBarAPI', {
  saveNote: (text) => ipcRenderer.invoke('save-note', text),
  dispatchCommand: (text) => ipcRenderer.invoke('dispatch-command', text),
  addToDoer: (text) => ipcRenderer.invoke('add-to-doer', text),
  searchApps: (query) => ipcRenderer.invoke('search-apps', query),
  getAppIcon: (appPath) => ipcRenderer.invoke('get-app-icon', appPath),
  launchApp: (appPath) => ipcRenderer.invoke('launch-app', appPath),
  resizeWindow: (height) => ipcRenderer.invoke('resize-window', height),
  calc: (expr) => ipcRenderer.invoke('calc', expr),
  windowManage: (action) => ipcRenderer.invoke('window-manage', action),
  convertCurrency: (amount, from, to) => ipcRenderer.invoke('convert-currency', amount, from, to),
  convertUnit: (text) => ipcRenderer.invoke('convert-unit', text),
  listProcesses: () => ipcRenderer.invoke('list-processes'),
  killProcess: (pid) => ipcRenderer.invoke('kill-process', pid),
  hideWindow: () => ipcRenderer.send('hide-window'),
  onClearInput: (callback) => {
    ipcRenderer.removeAllListeners('clear-input');
    ipcRenderer.on('clear-input', () => callback());
  },
  currencyCodes: ALL_CURRENCY_CODES_LOWER,
});