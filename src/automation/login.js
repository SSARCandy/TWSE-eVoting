const CONSTANTS = require('../constants');
const { waitForNavigation, safeExecute, delay } = require('./utils');

async function execute(webContents, nationalId, sendLog) {
  sendLog('[登入] 跳轉頁面...');
  
  try {
    await webContents.loadURL(CONSTANTS.URLS.LOGIN);
  } catch (err) {
    if (!err.message.includes('-3') && !err.message.includes('ERR_ABORTED')) {
      sendLog(`[登入] 載入失敗: ${err.message}`, 'error');
      return false;
    }

    sendLog(`[登入] 載入中斷，重試...`, 'warning');
    await delay(1500);
    try {
      await webContents.loadURL(CONSTANTS.URLS.LOGIN);
    } catch (retryErr) {
      sendLog(`[登入] 重試失敗: ${retryErr.message}`, 'error');
      return false;
    }
  }
  
  const readyScript = `
    (async () => {
      const delay = (ms) => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 20; i++) {
        if (document.getElementById('caType') || document.getElementById('pageIdNo')) return true;
        await delay(500);
      }
      return false;
    })()
  `;
  const ready = await safeExecute(webContents, readyScript, 12000);
  if (ready !== true) sendLog('[警告] 載入慢，稍候...', 'warning');

  sendLog('[登入] 填寫資訊...');

  const loginScript = `
    (async () => {
      const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      window.alert = (msg) => { window.__lastAlertMsg = msg; window.__lastAlert = Date.now(); return true; };
      window.confirm = (msg) => { window.__lastConfirmMsg = msg; window.__lastConfirm = Date.now(); return true; };
      
      const caTypeSelect = document.getElementById('caType');
      if (caTypeSelect) {
        caTypeSelect.value = 'SS'; 
        caTypeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof window.caTypeChange === 'function') window.caTypeChange();
      }
      await delay(Math.floor(Math.random() * 400) + 400);

      const idInput = document.querySelector('input[placeholder*="身分證"]') || 
                      document.querySelector('input[placeholder*="統編"]') ||
                      document.querySelector('input.required[placeholder*="身分證"]') || 
                      document.getElementById('pageIdNo') || 
                      document.getElementById('idNo') ||
                      document.querySelector('input[name="idNo"]');
      
      if (!idInput) throw new Error('找不到身分證/統編輸入框');

      idInput.focus();
      await delay(Math.floor(Math.random() * 100) + 100);
      idInput.value = '${nationalId}';
      ['input', 'change', 'blur'].forEach(evt => idInput.dispatchEvent(new Event(evt, { bubbles: true })));
      
      await delay(Math.floor(Math.random() * 400) + 400);

      const loginBtn = document.getElementById('loginBtn');
      if (!loginBtn) throw new Error('找不到登入按鈕');

      setTimeout(() => { try { loginBtn.click(); } catch(e) {} }, 50);
      return true;
    })()
  `;

  try {
    const success = await safeExecute(webContents, loginScript, 4000);
    if (typeof success === 'string' && success.includes('ERROR:') && !success.includes('TIMEOUT') && !success.includes('destroyed')) {
      sendLog('[警告] 填寫異常。', 'warning');
    }

    await waitForNavigation(webContents, 3000);

    const handleLoginDialog = `
      (async () => {
        const delay = (ms) => new Promise(r => setTimeout(r, ms));
        for (let i = 0; i < 6; i++) {
          if (window.__lastAlert || window.__lastConfirm) {
            const msg = window.__lastAlertMsg || window.__lastConfirmMsg || "NATIVE_DIALOG";
            window.__lastAlert = null;
            window.__lastConfirm = null;
            return "NATIVE_DIALOG_CAPTURED: " + msg;
          }

          const hasDialog = document.querySelector('.swal2-container.swal2-shown, .modal.show, .sweet-alert.visible') || 
                            Array.from(document.querySelectorAll('div, span, p')).some(el => 
                               el.innerText && (el.innerText.includes('重複登入') || el.innerText.includes('無待投票') || el.innerText.includes('無未投票') || el.innerText.includes('無可投票'))
                            );
          
          if (hasDialog) {
            const okBtn = document.getElementById('comfirmDialog_okBtn') || 
                          document.getElementById('confirmDialog_okBtn') ||
                          Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"], .swal2-confirm, .btn-primary'))
                            .find(el => {
                              const text = (el.innerText || el.value || "").trim();
                              return ['確認', '確定', 'OK'].some(kw => text.includes(kw)) || text === 'OK';
                            });
            
            if (okBtn) {
              setTimeout(() => okBtn.click(), 50);
              return "DOM_MODAL_CLICKED";
            }
          }
          await delay(500);
        }
        return "NO_DIALOG_FOUND";
      })()
    `;
    
    const result = await safeExecute(webContents, handleLoginDialog, 4000);
    const resultStr = String(result);
    
    if (resultStr.startsWith("DOM_MODAL_CLICKED") || resultStr.startsWith("NATIVE_DIALOG_CAPTURED")) {
      sendLog('[登入] 偵測提示，已點選。');
      await waitForNavigation(webContents, 3000);
    } else if (resultStr !== "NO_DIALOG_FOUND" && !resultStr.startsWith("ERROR: TIMEOUT") && !resultStr.includes('destroyed')) {
      sendLog('[警告] 登入對話框異常', 'warning');
    }
    
    let currentUrl = webContents.getURL();
    for (let k = 0; k < 5; k++) {
      if (!currentUrl.includes('login') || currentUrl.includes('index')) break;
      await delay(1000);
      currentUrl = webContents.getURL();
    }
    
    if (currentUrl.includes('login') && !currentUrl.includes('index')) {
      sendLog('[警告] 未跳轉，手動導航...', 'warning');
      await webContents.loadURL(CONSTANTS.URLS.INDEX);
      await delay(3000);
      currentUrl = webContents.getURL();
      if (currentUrl.includes('login') && !currentUrl.includes('index')) return false;
    }
    
    return true;
  } catch (err) {
    sendLog(`[登入] 腳本錯誤: ${err.message}`, 'error');
    return false;
  }
}

module.exports = { execute };