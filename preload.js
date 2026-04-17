const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startVoting: (ids, preference) => ipcRenderer.invoke('start-voting', { ids, preference }),
  stopVoting: () => ipcRenderer.invoke('stop-voting'),
  onLog: (callback) => ipcRenderer.on('log', (_event, value) => {
    // Only pass simple string value
    callback(String(value));
  }),
  onProgress: (callback) => ipcRenderer.on('progress', (_event, value) => {
    // Deep copy to ensure serializable data only
    callback(JSON.parse(JSON.stringify(value)));
  }),
});
