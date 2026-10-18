const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mediaExplorer', {
  getDrives: () => ipcRenderer.invoke('fs:drives'),
  addNetworkRoot: (networkPath) => ipcRenderer.invoke('settings:add-network-root', networkPath),
  removeNetworkRoot: (networkPath) => ipcRenderer.invoke('settings:remove-network-root', networkPath),
  getDirectories: (folderPath) => ipcRenderer.invoke('fs:directories', folderPath),
  getMediaFiles: (folderPath) => ipcRenderer.invoke('fs:media', folderPath),
  getTags: () => ipcRenderer.invoke('tags:list'),
  createTag: (name) => ipcRenderer.invoke('tags:create', name),
  deleteTag: (tagId) => ipcRenderer.invoke('tags:delete', tagId),
  getTagsForPaths: (filePaths) => ipcRenderer.invoke('tags:for-paths', filePaths),
  assignTag: (file, tagId) => ipcRenderer.invoke('tags:assign', file, tagId),
  unassignTag: (filePath, tagId) => ipcRenderer.invoke('tags:unassign', filePath, tagId),
  updateTagsForFiles: (files, changes) => ipcRenderer.invoke('tags:update-files', files, changes),
  openVideo: (filePath) => ipcRenderer.invoke('shell:open-video', filePath),
  getVideoThumbnail: (filePath, timeSeconds, jobId) => ipcRenderer.invoke('video:thumbnail', filePath, timeSeconds, jobId),
  cancelVideoThumbnail: (jobId) => ipcRenderer.invoke('video:cancel-thumbnail', jobId),
  getListThumbnail: (filePath, type, jobId) => ipcRenderer.invoke('media:list-thumbnail', filePath, type, jobId),
  cancelListThumbnail: (jobId) => ipcRenderer.invoke('media:cancel-thumbnail', jobId)
});
