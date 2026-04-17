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

let currentConfig = { outputDir: '' };

async function init() {
    currentConfig = await window.electronAPI.getConfig();
    if (currentConfig.outputDir) {
        outputDirInput.value = currentConfig.outputDir;
    }
    if (currentConfig.ids) {
        idsInput.value = currentConfig.ids;
    }
}

init();

let saveTimeout;
function debouncedSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
        currentConfig.ids = idsInput.value;
        // Sanitize object to avoid "An object could not be cloned" error
        const cleanConfig = JSON.parse(JSON.stringify(currentConfig));
        await window.electronAPI.saveConfig(cleanConfig);
    }, 1000);
}

idsInput.addEventListener('input', debouncedSave);

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

    const ids = rawIds.split('\n').map(id => id.trim()).filter(id => id.length > 0);
    const prefElement = document.querySelector('input[name="preference"]:checked');
    const preference = prefElement ? prefElement.value : 'agree';

    // Maintenance Guard (00:00 - 07:00 Taiwan Time UTC+8)
    const now = new Date();
    const utcHours = now.getUTCHours();
    const taiwanHours = (utcHours + 8) % 24;
    
    if (taiwanHours >= 0 && taiwanHours < 7) {
        const confirmMsg = `【維護提醒】\n目前為系統維護時間 (00:00 ~ 07:00)，股東e票通可能無法正常登入或投票。\n\n您確定要繼續執行嗎？`;
        if (!confirm(confirmMsg)) {
            return;
        }
        addLog('警告: 目前為維護時間，操作可能會失敗。', 'error');
    }

    // UI State
    startBtn.disabled = true;
    stopBtn.disabled = false;
    idsInput.disabled = true;
    statusDot.className = 'running';
    statusText.textContent = '執行中...';
    
    addLog(`開始執行，共 ${ids.length} 個身分證字號`, 'info');
    
    try {
        // Ensuring data is purely serializable to avoid cloning issues
        const sanitizedIds = JSON.parse(JSON.stringify(ids));
        const sanitizedPreference = String(preference);
        const outputDir = outputDirInput.value || '';
        
        const result = await window.electronAPI.startVoting(sanitizedIds, sanitizedPreference, outputDir);
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

clearLogBtn.addEventListener('click', () => {
    logContainer.innerHTML = '';
});

// IPC Listeners
window.electronAPI.onLog((msg) => {
    addLog(msg);
});

window.electronAPI.onProgress((data) => {
    // data: { currentIdIndex, totalIds, currentCompanyIndex, totalCompanies }
    const { currentIdIndex, totalIds, currentCompanyIndex, totalCompanies } = data;
    progressVal.textContent = `ID ${currentIdIndex + 1}/${totalIds} | 公司 ${currentCompanyIndex + 1}/${totalCompanies || 0}`;
    
    const percentage = ((currentIdIndex / totalIds) * 100);
    progressBarFill.style.width = `${percentage}%`;
});
