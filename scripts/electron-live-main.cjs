const { app, BrowserWindow } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow = null;

app.whenReady().then(() => {
  const preloadPath = path.resolve(__dirname, '../packages/adapters/dist/content-bridge.global.js');
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // Block popup windows and external window creation
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.loadURL('about:blank');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
