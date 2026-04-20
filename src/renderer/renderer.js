/**
 * UI Elements
 */
const UI = {
  inputs: {
    ids: document.getElementById('ids'),
    outputDir: document.getElementById('output-dir'),
    folderStructure: document.getElementById('folder-structure'),
  },
  buttons: {
    start: document.getElementById('start-btn'),
    stop: document.getElementById('stop-btn'),
    browse: document.getElementById('browse-btn'),
    copyLog: document.getElementById('copy-log'),
    clearLog: document.getElementById('clear-log'),
  },
  status: {
    dot: document.getElementById('status-dot'),
    text: document.getElementById('status-text'),
  },
  log: {
    container: document.getElementById('log-container'),
  },
  progress: {
    id: { val: document.getElementById('id-progress-val'), fill: document.getElementById('id-progress-fill') },
    vote: { val: document.getElementById('vote-progress-val'), fill: document.getElementById('vote-progress-fill') },
    shot: { val: document.getElementById('shot-progress-val'), fill: document.getElementById('shot-progress-fill') },
  },
};

/**
 * App State
 */
const State = {
  config: { outputDir: '', ids: '', folderStructure: 'by_id', includeCompanyName: false },
  saveTimeout: null,
};

/**
 * Core Functions
 */
const App = {
  async init() {
    State.config = await window.electronAPI.getConfig();
    if (State.config.outputDir) UI.inputs.outputDir.value = State.config.outputDir;
    if (State.config.ids) UI.inputs.ids.value = State.config.ids;
    if (State.config.folderStructure) UI.inputs.folderStructure.value = State.config.folderStructure;
    
    if (State.config.includeCompanyName !== undefined) {
      const radio = document.querySelector(`input[name="include-company-name"][value="${State.config.includeCompanyName}"]`);
      if (radio) radio.checked = true;
    }
    
    this.bindEvents();
    this.bindIPC();
  },

  bindEvents() {
    UI.inputs.ids.addEventListener('input', this.debouncedSave.bind(this));
    UI.inputs.folderStructure.addEventListener('change', this.debouncedSave.bind(this));
    document.getElementsByName('include-company-name').forEach(radio => {
      radio.addEventListener('change', this.debouncedSave.bind(this));
    });
    UI.buttons.browse.addEventListener('click', this.handleBrowse.bind(this));
    UI.buttons.start.addEventListener('click', this.handleStart.bind(this));
    UI.buttons.stop.addEventListener('click', this.handleStop.bind(this));
    UI.buttons.copyLog.addEventListener('click', this.handleCopyLog.bind(this));
    UI.buttons.clearLog.addEventListener('click', this.handleClearLog.bind(this));

    window.onerror = (message, source, lineno) => this.addLog(`[System UI Error] ${message} (at ${source}:${lineno})`, 'error');
    window.onunhandledrejection = (event) => this.addLog(`[Async Error] ${event.reason}`, 'error');
  },

  bindIPC() {
    window.electronAPI.onLog((msg) => this.addLog(msg));
    window.electronAPI.onProgress((data) => this.updateProgress(data));
  },

  debouncedSave() {
    clearTimeout(State.saveTimeout);
    State.saveTimeout = setTimeout(async () => {
      State.config.ids = UI.inputs.ids.value;
      State.config.folderStructure = UI.inputs.folderStructure.value;
      
      const checkedRadio = document.querySelector('input[name="include-company-name"]:checked');
      State.config.includeCompanyName = checkedRadio ? checkedRadio.value === 'true' : false;
      
      await window.electronAPI.saveConfig(JSON.parse(JSON.stringify(State.config)));
    }, 1000);
  },

  async handleBrowse() {
    const selectedDir = await window.electronAPI.selectDirectory();
    if (selectedDir) {
      UI.inputs.outputDir.value = selectedDir;
      State.config.outputDir = selectedDir;
      await window.electronAPI.saveConfig(JSON.parse(JSON.stringify(State.config)));
      this.addLog(`輸出資料夾已更改為: ${selectedDir}`, 'info');
    }
  },

  async handleStart() {
    const rawIds = UI.inputs.ids.value.trim();
    if (!rawIds) return this.addLog('請輸入身分證字號', 'error');

    const ids = rawIds.split(/[,\n]/).map(id => id.trim().toUpperCase()).filter(id => id.length > 0);
    const invalidIds = ids.filter(id => !this.isValidTaiwanID(id));
    
    if (invalidIds.length > 0) {
      return this.addLog(`無效的身分證字號，請檢查: ${invalidIds.join(', ')}`, 'error');
    }

    if (this.isMaintenanceTime()) {
      return this.addLog('系統維護中，請於 7:00~24:00 進行投票！', 'error');
    }

    this.setUIState(true);
    this.addLog(`開始執行，共 ${ids.length} 個帳號`, 'info');

    try {
      const sanitizedIds = JSON.parse(JSON.stringify(ids));
      const checkedRadio = document.querySelector('input[name="include-company-name"]:checked');
      const includeCompanyName = checkedRadio ? checkedRadio.value === 'true' : false;
      
      const result = await window.electronAPI.startVoting(
        sanitizedIds, 
        UI.inputs.outputDir.value || '', 
        UI.inputs.folderStructure.value,
        includeCompanyName
      );
      this.addLog(result.success ? '任務執行完畢' : `任務終止: ${result.error}`, result.success ? 'info' : 'error');
    } catch (err) {
      this.addLog(`系統錯誤: ${err.message}`, 'error');
    } finally {
      this.setUIState(false);
    }
  },

  async handleStop() {
    this.addLog('正在發出停止請求...', 'info');
    await window.electronAPI.stopVoting();
  },

  handleCopyLog() {
    const logs = Array.from(UI.log.container.querySelectorAll('.log-entry')).map(entry => entry.textContent).join('\n');
    if (logs) {
      navigator.clipboard.writeText(logs).then(() => {
        const originalText = UI.buttons.copyLog.textContent;
        UI.buttons.copyLog.textContent = '已複製';
        setTimeout(() => UI.buttons.copyLog.textContent = originalText, 2000);
      });
    }
  },

  handleClearLog() {
    UI.log.container.innerHTML = '';
  },

  addLog(message, type = '') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const timeStr = new Date().toTimeString().split(' ')[0];
    entry.textContent = `[${timeStr}] ${message}`;
    UI.log.container.appendChild(entry);
    UI.log.container.scrollTop = UI.log.container.scrollHeight;
  },

  updateProgress(data) {
    try {
      const updateBar = (type, current, total) => {
        const bar = UI.progress[type];
        if (!bar) return;
        bar.val.textContent = `${current}/${total}`;
        bar.fill.style.width = total > 0 ? `${(current / total) * 100}%` : '0%';
      };

      if (data.id) updateBar('id', data.id.current, data.id.total);
      if (data.vote) updateBar('vote', data.vote.current, data.vote.total);
      if (data.screenshot) updateBar('shot', data.screenshot.current, data.screenshot.total);
    } catch (e) {
      console.error('Progress update error:', e);
    }
  },

  setUIState(isRunning) {
    UI.buttons.start.disabled = isRunning;
    UI.buttons.stop.disabled = !isRunning;
    UI.inputs.ids.disabled = isRunning;
    UI.status.dot.className = isRunning ? 'running' : 'idle';
    UI.status.text.textContent = isRunning ? '執行中...' : '閒置中';
  },

  isValidTaiwanID(id) {
    if (!id) return false;
    const letters = 'ABCDEFGHJKLMNPQRSTUVXYWZIO';
    const firstCharIndex = letters.indexOf(id[0]);
    if (firstCharIndex === -1) return false;

    const firstNum = firstCharIndex + 10;
    const d1 = Math.floor(firstNum / 10);
    const d2 = firstNum % 10;
    const weights = [1, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1];

    if (/^[A-Z][1289]\d{8}$/.test(id)) {
      const idDigits = [d1, d2, ...id.slice(1).split('').map(Number)];
      return idDigits.reduce((sum, val, i) => sum + val * weights[i], 0) % 10 === 0;
    } else if (/^[A-Z][A-D]\d{8}$/.test(id)) {
      const secondNum = (letters.indexOf(id[1]) + 10) % 10;
      const idDigits = [d1, d2, secondNum, ...id.slice(2).split('').map(Number)];
      return idDigits.reduce((sum, val, i) => sum + val * weights[i], 0) % 10 === 0;
    }
    return false;
  },

  isMaintenanceTime() {
    const taiwanHours = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" })).getHours();
    return taiwanHours >= 0 && taiwanHours < 7;
  },
};

App.init();
