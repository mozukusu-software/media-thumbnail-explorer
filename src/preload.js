const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mediaExplorer', {
  getDrives: () => ipcRenderer.invoke('fs:drives'),
  addNetworkRoot: (networkPath) => ipcRenderer.invoke('settings:add-network-root', networkPath),
  removeNetworkRoot: (networkPath) => ipcRenderer.invoke('settings:remove-network-root', networkPath),
  getDirectories: (folderPath) => ipcRenderer.invoke('fs:directories', folderPath),
  getMediaFiles: (folderPath) => ipcRenderer.invoke('fs:media', folderPath),
  openVideo: (filePath) => ipcRenderer.invoke('shell:open-video', filePath),
  getVideoThumbnail: (filePath, timeSeconds) => ipcRenderer.invoke('video:thumbnail', filePath, timeSeconds),
  getListThumbnail: (filePath, type) => ipcRenderer.invoke('media:list-thumbnail', filePath, type)
});
