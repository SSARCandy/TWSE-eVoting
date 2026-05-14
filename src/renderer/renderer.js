/**
 * UI Elements
 */
const UI = {
  inputs: {
    ids: document.getElementById('ids'),
    outputDir: document.getElementById('output-dir'),
    folderStructure: document.getElementById('folder-structure'),
    filenamePattern: document.getElementById('filename-pattern'),
  },
  chips: {
    container: document.getElementById('filename-chips'),
    preview: document.getElementById('filename-preview'),
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
    val: document.getElementById('overall-progress-val'),
    fill: document.getElementById('overall-progress-fill'),
    status: document.getElementById('progress-status-text'),
  },
};

/**
 * App State
 */
const State = {
  config: { outputDir: '', ids: '', folderStructure: 'by_id', filenamePattern: '{id}_{code}' },
  saveTimeout: null,
  lastProgress: 0,
  chipDefinitions: [
    { id: '{id}', label: '身分證字號', required: true, example: 'A123456789' },
    { id: '{code}', label: '股號', required: true, example: '2330' },
    { id: '{name}', label: '公司名', required: false, example: '台積電' },
    { id: '{date}', label: '會議日', required: false, example: '1150512' }
  ],
};

/**
 * Core Functions
 */
const App = {
  async init() {
    State.config = await window.electronAPI.getConfig();
    const version = await window.electronAPI.getAppVersion();
    const versionEl = document.getElementById('about-icon');
    if (versionEl) versionEl.textContent = `v${version}`;

    if (State.config.outputDir) UI.inputs.outputDir.value = State.config.outputDir;
    if (State.config.ids) UI.inputs.ids.value = State.config.ids;
    if (State.config.folderStructure) UI.inputs.folderStructure.value = State.config.folderStructure;
    if (State.config.filenamePattern) UI.inputs.filenamePattern.value = State.config.filenamePattern;

    this.renderChips();
    this.bindEvents();
    this.bindIPC();
  },

  renderChips() {
    UI.chips.container.innerHTML = '';
    const pattern = State.config.filenamePattern || '{id}_{code}';
    const activeParts = pattern.split('_');

    // Add active chips in order
    activeParts.forEach(part => {
      const def = State.chipDefinitions.find(d => d.id === part);
      if (def) {
        UI.chips.container.appendChild(this.createChipElement(def, true));
      }
    });

    // Add inactive optional chips
    State.chipDefinitions.forEach(def => {
      if (!def.required && !activeParts.includes(def.id)) {
        UI.chips.container.appendChild(this.createChipElement(def, false));
      }
    });

    this.updateHiddenPattern();
  },

  createChipElement(def, isActive) {
    const chip = document.createElement('div');
    chip.className = `chip ${def.required ? 'required' : 'optional'} ${isActive ? 'active' : 'inactive'}`;
    if (!isActive) chip.style.opacity = '0.5';

    chip.draggable = true;
    chip.dataset.id = def.id;
    chip.innerHTML = `
      <span class="drag-handle">☰</span>
      ${def.label}
      ${!def.required ? `<span class="remove-btn">${isActive ? '×' : '+'}</span>` : ''}
    `;

    chip.addEventListener('dragstart', (e) => {
      chip.classList.add('dragging');
      e.dataTransfer.setData('text/plain', def.id);
    });

    chip.addEventListener('dragend', () => {
      chip.classList.remove('dragging');
    });

    if (!def.required) {
      const btn = chip.querySelector('.remove-btn');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleChip(def.id);
      });
    }

    return chip;
  },

  toggleChip(id) {
    const parts = UI.inputs.filenamePattern.value.split('_').filter(p => p);
    const index = parts.indexOf(id);
    if (index > -1) {
      parts.splice(index, 1);
    } else {
      parts.push(id);
    }
    State.config.filenamePattern = parts.join('_');
    this.renderChips();
    this.debouncedSave();
  },

  updateHiddenPattern() {
    const chips = Array.from(UI.chips.container.querySelectorAll('.chip.active'));
    const pattern = chips.map(c => c.dataset.id).join('_');
    UI.inputs.filenamePattern.value = pattern;
    State.config.filenamePattern = pattern;
    this.updatePreview();
  },

  updatePreview() {
    const pattern = UI.inputs.filenamePattern.value;
    if (!pattern) {
      UI.chips.preview.textContent = '預覽：(未設定)';
      return;
    }

    let preview = pattern;
    State.chipDefinitions.forEach(def => {
      preview = preview.replace(new RegExp(def.id.replace(/{/g, '\\{').replace(/}/g, '\\}'), 'g'), def.example);
    });
    UI.chips.preview.textContent = `預覽：${preview}.png`;
  },

  bindEvents() {
    UI.inputs.ids.addEventListener('input', this.debouncedSave.bind(this));
    UI.inputs.folderStructure.addEventListener('change', this.debouncedSave.bind(this));

    UI.chips.container.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dragging = document.querySelector('.dragging');
      if (!dragging) return;

      const afterElement = this.getDragAfterElement(UI.chips.container, e.clientX, e.clientY);
      if (afterElement == null) {
        UI.chips.container.appendChild(dragging);
      } else {
        UI.chips.container.insertBefore(dragging, afterElement);
      }
    });

    UI.chips.container.addEventListener('drop', (e) => {
      e.preventDefault();
      this.updateHiddenPattern();
      this.debouncedSave();
    });

    UI.buttons.browse.addEventListener('click', this.handleBrowse.bind(this));
    UI.buttons.start.addEventListener('click', this.handleStart.bind(this));
    UI.buttons.stop.addEventListener('click', this.handleStop.bind(this));
    UI.buttons.copyLog.addEventListener('click', this.handleCopyLog.bind(this));
    UI.buttons.clearLog.addEventListener('click', this.handleClearLog.bind(this));

    const versionEl = document.getElementById('about-icon');
    if (versionEl) {
      versionEl.addEventListener('click', () => {
        window.electronAPI.openAbout();
      });
    }

    window.onerror = (message, source, lineno) => this.addLog(`[System UI Error] ${message} (at ${source}:${lineno})`, 'error');
    window.onunhandledrejection = (event) => this.addLog(`[Async Error] ${event.reason}`, 'error');
  },

  getDragAfterElement(container, x, y) {
    const draggableElements = [...container.querySelectorAll('.chip:not(.dragging)')];

    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offsetX = x - box.left - box.width / 2;
      const offsetY = y - box.top - box.height / 2;

      // Calculate Euclidean distance for better multi-line support
      const distance = Math.sqrt(offsetX * offsetX + offsetY * offsetY);

      if (distance < closest.distance) {
        return { distance: distance, element: child };
      } else {
        return closest;
      }
    }, { distance: Number.POSITIVE_INFINITY }).element;
  },

  bindIPC() {
    window.electronAPI.onLog((msg, type) => this.addLog(msg, type));
    window.electronAPI.onProgress((data) => this.updateProgress(data));
  },

  debouncedSave() {
    clearTimeout(State.saveTimeout);
    State.saveTimeout = setTimeout(async () => {
      State.config.ids = UI.inputs.ids.value;
      State.config.folderStructure = UI.inputs.folderStructure.value;
      State.config.filenamePattern = UI.inputs.filenamePattern.value;

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

    const pattern = UI.inputs.filenamePattern.value || '{id}_{code}';
    if (!pattern.includes('{id}') || !pattern.includes('{code}')) {
      return this.addLog('檔名格式必須包含 {id} 與 {code}', 'error');
    }

    if (this.isMaintenanceTime()) {
      return this.addLog('系統維護中，請於 7:00~24:00 進行投票！', 'error');
    }

    this.setUIState(true);
    State.lastProgress = 0;
    UI.progress.val.textContent = '0%';
    UI.progress.fill.style.width = '0%';
    UI.progress.status.textContent = '(帳號: 0/0 | 投票: 0/0 | 截圖: 0/0)';
    this.addLog(`開始執行，共 ${ids.length} 個帳號`, 'info');

    try {
      const sanitizedIds = JSON.parse(JSON.stringify(ids));
      const result = await window.electronAPI.startVoting(
        sanitizedIds,
        UI.inputs.outputDir.value || '',
        UI.inputs.folderStructure.value,
        pattern
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
    const { id, vote, screenshot, status } = data;
    if (!id || id.total <= 0) return;

    const base = Math.max(0, id.current - 1);
    let accountProgress = 0;

    if (status === 'finished') {
      accountProgress = 1;
    } else if (status === 'initializing') {
      accountProgress = 0;
    } else {
      const hasVote = vote?.total > 0;
      const hasShot = screenshot?.total > 0;

      if (hasVote && hasShot) {
        accountProgress = (vote.current / vote.total * 0.5) + (screenshot.current / screenshot.total * 0.5);
      } else if (hasVote) {
        accountProgress = vote.current / vote.total;
      } else if (hasShot) {
        accountProgress = screenshot.current / screenshot.total;
      }
    }

    let totalPercent = Math.min(100, Math.max(0, Math.floor(((base + accountProgress) / id.total) * 100)));

    if (totalPercent < State.lastProgress) {
      totalPercent = State.lastProgress;
    }
    State.lastProgress = totalPercent;

    UI.progress.status.textContent = `(帳號: ${id?.current || 0}/${id?.total || 0} | 投票: ${vote?.globalCurrent || 0}/${vote?.globalTotal || 0} | 截圖: ${screenshot?.globalCurrent || 0}/${screenshot?.globalTotal || 0})`;
    UI.progress.val.textContent = `${totalPercent}%`;
    UI.progress.fill.style.width = `${totalPercent}%`;
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
    const taiwanHour = (new Date().getUTCHours() + 8) % 24;
    return taiwanHour >= 0 && taiwanHour < 7;
  },
};

App.init();
