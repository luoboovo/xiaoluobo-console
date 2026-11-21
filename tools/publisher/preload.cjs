const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('publisher', {
  state: () => ipcRenderer.invoke('state'),
  online: () => ipcRenderer.invoke('online'),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  inspect: dir => ipcRenderer.invoke('inspect', dir),
  saveCredentials: input => ipcRenderer.invoke('save-credentials', input),
  clearCredentials: () => ipcRenderer.invoke('clear-credentials'),
  publish: dir => ipcRenderer.invoke('publish', dir),
  openBucket: () => ipcRenderer.invoke('open-bucket'),
  // 把文件夹拖进窗口时拿到它的路径。
  pathOf: file => webUtils.getPathForFile(file),
  on: (channel, listener) => { if (['inspect-progress', 'publish-step'].includes(channel)) ipcRenderer.on(channel, (_event, data) => listener(data)); }
});
