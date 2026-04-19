const { app, BrowserWindow, BrowserView, ipcMain, session, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let browserView;
let stopRequested = false;

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

function getConfig() {
  const defaultConfig = { outputDir: '', ids: '', folderStructure: 'by_id' };
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      return { ...defaultConfig, ...config };
    }
  } catch (err) {
    console.error('Failed to read config:', err);
  }
  return defaultConfig;
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
    icon: path.join(__dirname, 'assets/icons/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: '台灣股東會自動投票系統'
  });

  mainWindow.loadFile(path.join(__dirname, 'src/renderer/index.html'));

  // Handler for aligning DevTools shortcuts (F12 or Ctrl+Shift+I)
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

  // Enable toggling DevTools for the main window
  mainWindow.webContents.on('before-input-event', handleDevToolsShortcut(mainWindow.webContents));

  browserView = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  mainWindow.setBrowserView(browserView);

  // Left panel is 450px, right is the rest
  const updateBounds = () => {
    const { width, height } = mainWindow.getContentBounds();
    browserView.setBounds({ x: 450, y: 0, width: width - 450, height: height });
  };

  updateBounds();
  mainWindow.on('resize', updateBounds);

  browserView.webContents.on('before-input-event', handleDevToolsShortcut(browserView.webContents));

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

function setupApplicationMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac
      ? [{
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      }]
      : []),
    {
      label: '編輯 (Edit)',
      submenu: [
        { label: '復原 (Undo)', role: 'undo' },
        { label: '重做 (Redo)', role: 'redo' },
        { type: 'separator' },
        { label: '剪下 (Cut)', role: 'cut' },
        { label: '複製 (Copy)', role: 'copy' },
        { label: '貼上 (Paste)', role: 'paste' },
        ...(isMac
          ? [
            { role: 'pasteAndMatchStyle' },
            { role: 'delete' },
            { label: '全選 (Select All)', role: 'selectAll' },
          ]
          : [
            { label: '刪除 (Delete)', role: 'delete' },
            { type: 'separator' },
            { label: '全選 (Select All)', role: 'selectAll' }
          ])
      ]
    },
    {
      label: '檢視 (View)',
      submenu: [
        { label: '重新載入 (Reload)', role: 'reload' },
        { label: '強制重新載入 (Force Reload)', role: 'forceReload' },
        { type: 'separator' },
        {
          label: '右側網頁開發者工具 (BrowserView DevTools)',
          accelerator: 'F12',
          click: () => {
            if (browserView) {
              browserView.webContents.toggleDevTools();
            }
          }
        },
        { type: 'separator' },
        { label: '實際大小 (Reset Zoom)', role: 'resetZoom' },
        { label: '放大 (Zoom In)', role: 'zoomIn' },
        { label: '縮小 (Zoom Out)', role: 'zoomOut' },
        { type: 'separator' },
        { label: '切換全螢幕 (Toggle Full Screen)', role: 'togglefullscreen' }
      ]
    },
    {
      label: '關於 (About)',
      submenu: [
        {
          label: '關於 TWSE Auto eVoting',
          click: async () => {
            const { shell } = require('electron');
            const pkg = require('./package.json');
            let releaseDate = '未知';
            try {
              // 在封裝後的 asar 檔案中，package.json 的修改時間即為打包/釋出時間
              const stat = require('fs').statSync(require('path').join(__dirname, 'package.json'));
              releaseDate = stat.mtime.toISOString().split('T')[0];
            } catch (e) { }

            const { response } = await dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '關於 TWSE Auto eVoting',
              message: `TWSE Auto eVoting\n\n版本 (Version): ${pkg.version}\n日期 (Release Date): ${releaseDate}`,
              buttons: ['使用說明 (README)', 'GitHub', '作者網站', '關閉'],
              defaultId: 0,
              cancelId: 3
            });

            if (response === 0) {
              shell.openExternal('https://github.com/SSARCandy/TWSE-Auto-eVoting/blob/master/README.md');
            } else if (response === 1) {
              shell.openExternal('https://github.com/SSARCandy/TWSE-Auto-eVoting');
            } else if (response === 2) {
              shell.openExternal('https://ssarcandy.tw');
            }
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  setupApplicationMenu();
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers
ipcMain.handle('start-voting', async (event, { ids, outputDir, folderStructure }) => {
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
    }, () => stopRequested, outputDir, folderStructure);
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
