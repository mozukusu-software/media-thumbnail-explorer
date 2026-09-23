const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mediaExplorer', {
  getDrives: () => ipcRenderer.invoke('fs:drives'),
  addNetworkRoot: (networkPath) => ipcRenderer.invoke('settings:add-network-root', networkPath),
  removeNetworkRoot: (networkPath) => ipcRenderer.invoke('settings:remove-network-root', networkPath),
  getDirectories: (folderPath) => ipcRenderer.invoke('fs:directories', folderPath),
  getMediaFiles: (folderPath) => ipcRenderer.invoke('fs:media', folderPath),
  openVideo: (filePath) => ipcRenderer.invoke('shell:open-video', filePath),
  getVideoThumbnail: (filePath, timeSeconds, jobId) => ipcRenderer.invoke('video:thumbnail', filePath, timeSeconds, jobId),
  cancelVideoThumbnail: (jobId) => ipcRenderer.invoke('video:cancel-thumbnail', jobId),
  getListThumbnail: (filePath, type, jobId) => ipcRenderer.invoke('media:list-thumbnail', filePath, type, jobId),
  cancelListThumbnail: (jobId) => ipcRenderer.invoke('media:cancel-thumbnail', jobId)
});
