const idsInput = document.getElementById('ids');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const progressVal = document.getElementById('progress-val');
const progressBarFill = document.getElementById('progress-bar-fill');
const logContainer = document.getElementById('log-container');
const clearLogBtn = document.getElementById('clear-log');
const outputDirInput = document.getElementById('output-dir');
const browseBtn = document.getElementById('browse-btn');
const folderStructureSelect = document.getElementById('folder-structure');

let currentConfig = { outputDir: '', ids: '', folderStructure: 'by_id' };

async function init() {
    currentConfig = await window.electronAPI.getConfig();
    if (currentConfig.outputDir) {
        outputDirInput.value = currentConfig.outputDir;
    }
    if (currentConfig.ids) {
        idsInput.value = currentConfig.ids;
    }
    if (currentConfig.folderStructure) {
        folderStructureSelect.value = currentConfig.folderStructure;
    }
}

init();

let saveTimeout;
function debouncedSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
        currentConfig.ids = idsInput.value;
        currentConfig.folderStructure = folderStructureSelect.value;
        const cleanConfig = JSON.parse(JSON.stringify(currentConfig));
        await window.electronAPI.saveConfig(cleanConfig);
    }, 1000);
}

idsInput.addEventListener('input', debouncedSave);
folderStructureSelect.addEventListener('change', debouncedSave);

browseBtn.addEventListener('click', async () => {
    const selectedDir = await window.electronAPI.selectDirectory();
    if (selectedDir) {
        outputDirInput.value = selectedDir;
        currentConfig.outputDir = selectedDir;
        const cleanConfig = JSON.parse(JSON.stringify(currentConfig));
        await window.electronAPI.saveConfig(cleanConfig);
        addLog(`輸出資料夾已更改為: ${selectedDir}`, 'info');
    }
});

function addLog(message, type = '') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    entry.textContent = `[${timeStr}] ${message}`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

startBtn.addEventListener('click', async () => {
    const rawIds = idsInput.value.trim();
    if (!rawIds) {
        addLog('請輸入身分證字號', 'error');
        return;
    }

    const ids = rawIds.split(/[,\n]/).map(id => id.trim()).filter(id => id.length > 0);

    // Maintenance Guard (00:00 - 07:00 Taiwan Time UTC+8)
    const now = new Date();
    const taiwantime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
    const taiwanHours = taiwantime.getHours();

    if (taiwanHours >= 0 && taiwanHours < 7) {
        addLog('系統維護中，請於 7:00~24:00 進行投票！', 'error');
        return;
    }

    // UI State
    startBtn.disabled = true;
    stopBtn.disabled = false;
    idsInput.disabled = true;
    statusDot.className = 'running';
    statusText.textContent = '執行中...';

    addLog(`開始執行，共 ${ids.length} 個帳號`, 'info');

    try {
        const sanitizedIds = JSON.parse(JSON.stringify(ids));
        const outputDir = outputDirInput.value || '';
        const folderStructure = folderStructureSelect.value;

        const result = await window.electronAPI.startVoting(sanitizedIds, outputDir, folderStructure);
        if (result.success) {
            addLog('任務執行完畢', 'info');
        } else {
            addLog(`任務終止: ${result.error}`, 'error');
        }
    } catch (err) {
        addLog(`系統錯誤: ${err.message}`, 'error');
    } finally {
        // Reset UI
        startBtn.disabled = false;
        stopBtn.disabled = true;
        idsInput.disabled = false;
        statusDot.className = 'idle';
        statusText.textContent = '閒置中';
    }
});

stopBtn.addEventListener('click', async () => {
    addLog('正在發出停止請求...', 'info');
    await window.electronAPI.stopVoting();
});

const copyLogBtn = document.getElementById('copy-log');

copyLogBtn.addEventListener('click', () => {
    const logs = Array.from(logContainer.querySelectorAll('.log-entry'))
        .map(entry => entry.textContent)
        .join('\n');

    if (logs) {
        navigator.clipboard.writeText(logs).then(() => {
            const originalText = copyLogBtn.textContent;
            copyLogBtn.textContent = '已複製';
            setTimeout(() => {
                copyLogBtn.textContent = originalText;
            }, 2000);
        });
    }
});

clearLogBtn.addEventListener('click', () => {
    logContainer.innerHTML = '';
});

// Global Error Handlers to Catch "Cloning" or other IPC issues
window.onerror = function (message, source, lineno, colno, error) {
    addLog(`[System UI Error] ${message} (at ${source}:${lineno})`, 'error');
};

window.onunhandledrejection = function (event) {
    addLog(`[Async Error] ${event.reason}`, 'error');
};

// IPC Listeners
window.electronAPI.onLog((msg) => {
    addLog(msg);
});

window.electronAPI.onProgress((data) => {
    try {
        const updateBar = (valId, fillId, current, total) => {
            const valEl = document.getElementById(valId);
            const fillEl = document.getElementById(fillId);
            if (valEl) valEl.textContent = `${current}/${total}`;
            if (fillEl) fillEl.style.width = total > 0 ? `${(current / total) * 100}%` : '0%';
        };

        if (data.id) updateBar('id-progress-val', 'id-progress-fill', data.id.current, data.id.total);
        if (data.vote) updateBar('vote-progress-val', 'vote-progress-fill', data.vote.current, data.vote.total);
        if (data.screenshot) updateBar('shot-progress-val', 'shot-progress-fill', data.screenshot.current, data.screenshot.total);
    } catch (e) {
        console.error('Progress update error:', e);
    }
});
