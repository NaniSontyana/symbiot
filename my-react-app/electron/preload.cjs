const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  toggleStealthMode: () => ipcRenderer.send('toggle-stealth-mode'),
  toggleClickThrough: (ignore) => ipcRenderer.send('toggle-click-through', ignore),
  setWindowOpacity: (opacity) => ipcRenderer.send('set-window-opacity', opacity),
  resizeWindow: (dimensions) => ipcRenderer.send('resize-window', dimensions),
  closeApp: () => ipcRenderer.send('close-app'),

  // Desktop Screen Switching APIs
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  switchDisplay: (displayId) => ipcRenderer.send('switch-display', displayId),
  onDisplaySwitched: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('display-switched', handler);
    return () => ipcRenderer.removeListener('display-switched', handler);
  },

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
