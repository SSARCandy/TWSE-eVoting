const { app, BrowserWindow, BrowserView, ipcMain, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let browserView;
let stopRequested = false;

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

function getConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to read config:', err);
  }
  return { outputDir: '', ids: '' };
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    return true;
  } catch (err) {
    console.error('Failed to save config:', err);
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: '台灣股東會自動投票系統'
  });

  mainWindow.loadFile(path.join(__dirname, 'src/renderer/index.html'));

  browserView = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  mainWindow.setBrowserView(browserView);

  // Left panel is 400px, right is the rest
  const updateBounds = () => {
    const { width, height } = mainWindow.getContentBounds();
    browserView.setBounds({ x: 400, y: 0, width: width - 400, height: height });
  };

  updateBounds();
  mainWindow.on('resize', updateBounds);

  const CONSTANTS = require('./src/constants');
  browserView.webContents.loadURL(CONSTANTS.URLS.LOGIN);

  // Handle client certificate selection automatically
  app.on('select-client-certificate', (event, webContents, url, list, callback) => {
    event.preventDefault();
    if (list && list.length > 0) {
      // Find brokerage certificate (typically from a bank or broker)
      // For now, we auto-select the first one as requested
      callback(list[0]);
    }
  });

  // Use standard dialog handling if needed
  browserView.webContents.on('did-finish-load', () => {
    // We handle dialogs in the automation scripts via DOM or other means
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers
ipcMain.handle('start-voting', async (event, { ids, outputDir }) => {
  stopRequested = false;
  const automation = require('./src/automation/main_flow');
  try {
    await automation.run(browserView.webContents, ids, (msg) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('log', String(msg));
      }
    }, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const sanitizedProgress = JSON.parse(JSON.stringify(progress));
        mainWindow.webContents.send('progress', sanitizedProgress);
      }
    }, () => stopRequested, outputDir);
    return JSON.parse(JSON.stringify({ success: true }));
  } catch (error) {
    console.error('Automation error:', error);
    return JSON.parse(JSON.stringify({ success: false, error: String(error.message) }));
  }
});

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  const path = result.canceled ? null : result.filePaths[0];
  return JSON.parse(JSON.stringify(path));
});

ipcMain.handle('get-config', async () => {
  const config = getConfig();
  return JSON.parse(JSON.stringify(config));
});

ipcMain.handle('save-config', async (event, config) => {
  const success = saveConfig(config);
  return JSON.parse(JSON.stringify(success));
});

ipcMain.handle('stop-voting', () => {
  stopRequested = true;
  return JSON.parse(JSON.stringify({ success: true }));
});
