const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startVoting: (ids, preference, outputDir) => ipcRenderer.invoke('start-voting', { ids, preference, outputDir }),
  stopVoting: () => ipcRenderer.invoke('stop-voting'),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  onLog: (callback) => ipcRenderer.on('log', (_event, value) => {
    // Only pass simple string value
    callback(String(value));
  }),
  onProgress: (callback) => ipcRenderer.on('progress', (_event, value) => {
    // Deep copy to ensure serializable data only
    callback(JSON.parse(JSON.stringify(value)));
  }),
});
