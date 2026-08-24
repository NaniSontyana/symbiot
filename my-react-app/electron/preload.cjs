const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  toggleStealthMode: () => ipcRenderer.send('toggle-stealth-mode'),
  toggleClickThrough: (ignore) => ipcRenderer.send('toggle-click-through', ignore),
  setWindowOpacity: (opacity) => ipcRenderer.send('set-window-opacity', opacity),
  resizeWindow: (dimensions) => ipcRenderer.send('resize-window', dimensions),
  closeApp: () => ipcRenderer.send('close-app'),

  // Global hotkey listeners
  onHotkeyToggleStealth: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('hotkey-toggle-stealth', handler);
    return () => ipcRenderer.removeListener('hotkey-toggle-stealth', handler);
  },
  onHotkeyToggleClickThrough: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('hotkey-toggle-clickthrough', handler);
    return () => ipcRenderer.removeListener('hotkey-toggle-clickthrough', handler);
  },
  onHotkeyToggleHide: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('hotkey-toggle-hide', handler);
    return () => ipcRenderer.removeListener('hotkey-toggle-hide', handler);
  },
});
