const { app, BrowserWindow, BrowserView, ipcMain, shell, Notification, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const pkg = require('./package.json');
const APP_VERSION = pkg.version;

let mainWindow;
let browserView;
let stopRequested = false;

// Mask Electron User-Agent
app.userAgentFallback = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function getConfig() {
  const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
  const defaultConfig = { outputDir: '', ids: '', folderStructure: 'by_id', includeCompanyName: false };
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return { ...defaultConfig, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
    }
  } catch (e) {}
  return defaultConfig;
}

function saveConfig(config) {
  const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    return true;
  } catch (e) { return false; }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: true,
    backgroundColor: '#1a1a2e',
    paintWhenInitiallyHidden: false,
    icon: path.join(__dirname, 'assets/icons/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
    title: '股東會投票幫手',
  });

  mainWindow.loadFile(path.join(__dirname, 'src/renderer/index.html'));

  const handleDevToolsShortcut = (targetWebContents) => (event, input) => {
    if (input.type === 'keyDown') {
      const isF12 = input.key === 'F12';
      const isCtrlShiftI = input.key.toLowerCase() === 'i' && (input.control || input.meta) && input.shift;
      if (isF12 || isCtrlShiftI) {
        targetWebContents.toggleDevTools();
        event.preventDefault();
      }
    }
  };

  mainWindow.webContents.on('before-input-event', handleDevToolsShortcut(mainWindow.webContents));

  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const CONSTANTS = require('./src/constants');
    
    browserView = new BrowserView({
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    mainWindow.setBrowserView(browserView);
    const updateBounds = () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const { width, height } = mainWindow.getContentBounds();
      browserView.setBounds({ x: 450, y: 0, width: width - 450, height: height });
    };

    updateBounds();
    mainWindow.on('resize', updateBounds);
    browserView.webContents.on('before-input-event', handleDevToolsShortcut(browserView.webContents));
    browserView.webContents.loadURL(CONSTANTS.URLS.LOGIN);
  }, 400);

  app.on('select-client-certificate', (event, webContents, url, list, callback) => {
    event.preventDefault();
    if (list && list.length > 0) callback(list[0]);
  });
}

app.whenReady().then(() => {
  createWindow();
  Menu.setApplicationMenu(null);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('get-app-version', () => {
  return APP_VERSION;
});

ipcMain.handle('start-voting', async (event, { ids, outputDir, folderStructure, includeCompanyName }) => {
  stopRequested = false;
  const automation = require('./src/automation/main_flow');
  try {
    const stats = await automation.run(browserView.webContents, ids, (msg) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('log', String(msg));
    }, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('progress', JSON.parse(JSON.stringify(progress)));
        const { id, screenshot } = progress;
        let percent = 0;
        if (id && id.total > 0) {
          let base = id.current - (screenshot && screenshot.total > 0 ? 1 : 0);
          percent = Math.floor(((base + (screenshot ? screenshot.current / screenshot.total : 0)) / id.total) * 100);
        }
        mainWindow.setTitle(`(${Math.min(100, Math.max(0, percent))}%) 股東會投票幫手`);
      }
    }, () => stopRequested, outputDir, folderStructure, includeCompanyName);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle('股東會投票幫手');
      if (stats) mainWindow.webContents.send('log', `[系統] 完成。累計投票: ${stats.voted}，累計截圖: ${stats.screenshoted}`);
      if (!mainWindow.isFocused() && Notification.isSupported()) {
        new Notification({ title: '投票完成', body: '所有作業已結束。', icon: path.join(__dirname, 'assets/icons/icon.png') }).show();
      }
    }
    return { success: true };
  } catch (error) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle('股東會投票幫手');
      if (!mainWindow.isFocused() && Notification.isSupported()) {
        new Notification({ title: '投票錯誤', body: error.message, icon: path.join(__dirname, 'assets/icons/icon.png') }).show();
      }
    }
    return { success: false, error: error.message };
  }
});

ipcMain.handle('select-directory', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('get-config', async () => getConfig());
ipcMain.handle('save-config', async (event, config) => saveConfig(config));
ipcMain.handle('open-about', async () => {
  const aboutWindow = new BrowserWindow({
    width: 400,
    height: 450,
    resizable: false,
    autoHideMenuBar: true,
    title: '關於股東會投票幫手',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  aboutWindow.loadFile(path.join(__dirname, 'src/renderer/about.html'));
  return { success: true };
});

ipcMain.handle('open-external', async (event, url) => {
  await shell.openExternal(url);
  return { success: true };
});

ipcMain.handle('stop-voting', () => { stopRequested = true; return { success: true }; });