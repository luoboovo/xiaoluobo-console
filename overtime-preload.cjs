const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('overtimeWindow', {
  drag:phase => { if (['start','move','end','resize-start','resize-move'].includes(phase)) ipcRenderer.send('overtime-drag',phase); }
});
