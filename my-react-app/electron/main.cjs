const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const path = require('path');

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
    },
  });

  // Enable Screen-Share Protection (Undetectable on Zoom, Teams, Meet)
  mainWindow.setContentProtection(true);

  // Keep on top of all windows
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  const devServerUrl = 'http://localhost:5174';
  mainWindow.loadURL(devServerUrl).catch(() => {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  // Global Keyboard Shortcuts
  globalShortcut.register('CommandOrControl+Alt+S', () => {
    if (mainWindow) {
      const isStealth = mainWindow.getBounds().width < 800;
      if (isStealth) {
        mainWindow.setSize(1100, 750);
      } else {
        mainWindow.setSize(680, 500);
      }
    }
  });

  globalShortcut.register('CommandOrControl+Alt+H', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
      }
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
    mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
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
