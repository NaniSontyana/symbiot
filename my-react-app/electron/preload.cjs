const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  toggleStealthMode: () => ipcRenderer.send('toggle-stealth-mode'),
  toggleClickThrough: (ignore) => ipcRenderer.send('toggle-click-through', ignore),
  setWindowOpacity: (opacity) => ipcRenderer.send('set-window-opacity', opacity),
  resizeWindow: (dimensions) => ipcRenderer.send('resize-window', dimensions),
  closeApp: () => ipcRenderer.send('close-app'),
});
