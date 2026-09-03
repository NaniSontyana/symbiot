const { app, BrowserWindow, globalShortcut, ipcMain, screen, session, desktopCapturer } = require('electron');
const path = require('path');

// Disable GPU/HTTP disk cache conflicts, isolate session userData, and allow no-user-gesture WebAudio autoplay
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
try {
  app.setPath('userData', path.join(app.getPath('temp'), 'symbiot-electron-userData'));
} catch (e) {}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  // Enable Screen-Share Protection (Undetectable on Zoom, Teams, Meet)
  mainWindow.setContentProtection(true);

  // Keep pinned on top of all websites, web pages, full-screen browsers, and desktop apps
  mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  if (mainWindow.setVisibleOnAllWorkspaces) {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  const devServerUrl = 'http://localhost:5174';
  mainWindow.loadURL(devServerUrl).catch(() => {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Auto-grant media (microphone & audio capture) permissions in Electron
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'media' || permission === 'display-capture') return true;
    return true;
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'display-capture') {
      return callback(true);
    }
    callback(true);
  });

  createWindow();

  // Configure Electron Display & Screen Share Request Handler for getDisplayMedia
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      if (sources && sources.length > 0) {
        callback({ video: sources[0], audio: request.audioRequested ? 'loopback' : undefined });
      } else {
        callback({});
      }
    } catch (err) {
      console.error('[Electron] displayMediaRequestHandler error:', err);
      callback({});
    }
  });

  let isClickThrough = false;

  // Global Keyboard Shortcuts
  globalShortcut.register('CommandOrControl+Alt+S', () => {
    if (mainWindow) {
      const isStealth = mainWindow.getBounds().width < 800;
      const targetStealth = !isStealth;
      if (targetStealth) {
        mainWindow.setSize(680, 500);
      } else {
        mainWindow.setSize(1100, 750);
      }
      mainWindow.webContents.send('hotkey-toggle-stealth', targetStealth);
    }
  });

  globalShortcut.register('CommandOrControl+Alt+C', () => {
    if (mainWindow) {
      isClickThrough = !isClickThrough;
      mainWindow.setIgnoreMouseEvents(isClickThrough);
      mainWindow.webContents.send('hotkey-toggle-clickthrough', isClickThrough);
    }
  });

  globalShortcut.register('CommandOrControl+Alt+H', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
        mainWindow.webContents.send('hotkey-toggle-hide', true);
      } else {
        mainWindow.show();
        mainWindow.webContents.send('hotkey-toggle-hide', false);
      }
    }
  });

  globalShortcut.register('CommandOrControl+Alt+D', () => {
    if (mainWindow) {
      const displays = screen.getAllDisplays();
      if (displays.length <= 1) return;
      const currentBounds = mainWindow.getBounds();
      const currentDisplay = screen.getDisplayMatching(currentBounds);
      const currentIndex = displays.findIndex(d => d.id === currentDisplay.id);
      const nextIndex = (currentIndex + 1) % displays.length;
      const nextDisplay = displays[nextIndex];
      const { x, y, width, height } = nextDisplay.bounds;
      const newX = Math.round(x + (width - currentBounds.width) / 2);
      const newY = Math.round(y + (height - currentBounds.height) / 2);
      mainWindow.setPosition(newX, newY);
      mainWindow.webContents.send('display-switched', { id: nextDisplay.id, index: nextIndex });
    }
  });

  globalShortcut.register('CommandOrControl+Alt+X', () => {
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// IPC Event Listeners
ipcMain.handle('get-displays', () => {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  return displays.map((d, index) => ({
    id: d.id,
    label: `Display ${index + 1} (${d.bounds.width}x${d.bounds.height})${d.id === primary.id ? ' - Primary' : ''}`,
    bounds: d.bounds,
    isPrimary: d.id === primary.id,
  }));
});

ipcMain.handle('get-desktop-sources', async () => {
  try {
    const { desktopCapturer } = require('electron');
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 }
    });
    return sources.map(src => ({
      id: src.id,
      name: src.name,
      thumbnail: src.thumbnail ? src.thumbnail.toDataURL() : '',
      display_id: src.display_id
    }));
  } catch (err) {
    console.error('Error fetching desktop sources:', err);
    return [];
  }
});

ipcMain.on('switch-display', (event, displayId) => {
  if (!mainWindow) return;
  const displays = screen.getAllDisplays();
  const targetDisplay = displays.find(d => d.id === displayId) || displays[0];
  if (targetDisplay) {
    const { x, y, width, height } = targetDisplay.bounds;
    const winBounds = mainWindow.getBounds();
    const newX = Math.round(x + (width - winBounds.width) / 2);
    const newY = Math.round(y + (height - winBounds.height) / 2);
    mainWindow.setPosition(newX, newY);
  }
});

// IPC Event Listeners
ipcMain.on('resize-window', (event, { isCollapsed, stealthMode }) => {
  if (mainWindow) {
    if (isCollapsed) {
      mainWindow.setSize(220, 68);
    } else if (stealthMode) {
      mainWindow.setSize(680, 500);
    } else {
      mainWindow.setSize(1100, 750);
    }
  }
});

ipcMain.on('toggle-click-through', (event, ignore) => {
  if (mainWindow) {
    isClickThrough = ignore;
    if (ignore) {
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
      mainWindow.setIgnoreMouseEvents(false);
    }
  }
});

ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
  if (mainWindow) {
    mainWindow.setIgnoreMouseEvents(ignore, options || { forward: true });
  }
});

ipcMain.on('set-window-opacity', (event, opacity) => {
  if (mainWindow) {
    mainWindow.setOpacity(opacity);
  }
});

ipcMain.on('close-app', () => {
  app.quit();
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') app.quit();
});
