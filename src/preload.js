const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mediaExplorer', {
  getDrives: () => ipcRenderer.invoke('fs:drives'),
  getDirectories: (folderPath) => ipcRenderer.invoke('fs:directories', folderPath),
  getMediaFiles: (folderPath) => ipcRenderer.invoke('fs:media', folderPath),
  openVideo: (filePath) => ipcRenderer.invoke('shell:open-video', filePath),
  getVideoThumbnail: (filePath, timeSeconds) => ipcRenderer.invoke('video:thumbnail', filePath, timeSeconds)
});
