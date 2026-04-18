/**
 * 登入自動化邏輯
 */

const CONSTANTS = require('../constants');

async function execute(webContents, nationalId, sendLog) {
  sendLog('正在跳轉至登入頁面...');
  
  try {
    await webContents.loadURL(CONSTANTS.URLS.LOGIN);
  } catch (err) {
    sendLog(`載入頁面失敗: ${err.message}`, 'error');
    return false;
  }
  
  const safeExecute = async (script, timeoutMs = 3000) => {
    try {
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs));
      const execPromise = webContents.executeJavaScript(script);
      return await Promise.race([execPromise, timeoutPromise]);
    } catch (err) {
      return "ERROR: " + err.message;
    }
  };

  // Faster proactive check for existence of key element
  const ready = await safeExecute(`
    (async () => {
      for (let i = 0; i < 20; i++) { // Max 10s total
        if (document.getElementById('caType') || document.getElementById('pageIdNo')) return true;
        await new Promise(r => setTimeout(r, 500));
      }
      return false;
    })()
  `, 12000);

  if (ready !== true) {
    sendLog('等待登入頁面元件逾時，可能載入過慢或 URL 錯誤。', 'warning');
  }

  sendLog('正在填寫登入資訊...');

  const loginScript = `
    (async () => {
      const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      
      // 預防同步 alert 阻擋執行
      window.alert = (msg) => { window.__lastAlertMsg = msg; window.__lastAlert = Date.now(); return true; };
      window.confirm = (msg) => { window.__lastConfirmMsg = msg; window.__lastConfirm = Date.now(); return true; };
      
      // 1. 選擇券商網路下單憑證
      const caTypeSelect = document.getElementById('caType');
      if (caTypeSelect) {
        caTypeSelect.value = 'SS'; 
        caTypeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof window.caTypeChange === 'function') window.caTypeChange();
      }
      await delay(800);

      // 2. 填入身分證字號 / 統編
      const idInput = document.querySelector('input[placeholder*="身分證"]') || 
                      document.querySelector('input[placeholder*="統編"]') ||
                      document.querySelector('input.required[placeholder*="身分證"]') || 
                      document.getElementById('pageIdNo') || 
                      document.getElementById('idNo') ||
                      document.querySelector('input[name="idNo"]');
      
      if (!idInput) {
        throw new Error('找不到身分證/統編輸入框');
      }

      idInput.focus();
      await delay(200);
      idInput.value = '${nationalId}';
      ['input', 'change', 'blur'].forEach(evt => idInput.dispatchEvent(new Event(evt, { bubbles: true })));
      
      await delay(800);

      // 3. 點擊登入
      const loginBtn = document.getElementById('loginBtn');
      if (!loginBtn) {
        throw new Error('找不到登入按鈕 (預期 ID: loginBtn)');
      }

      // 使用 setTimeout 避免點擊觸發導航時卡住 executeJavaScript Promise
      setTimeout(() => {
          try { loginBtn.click(); } catch(e) {}
      }, 50);
      
      return true;
    })()
  `;

  try {
    const success = await safeExecute(loginScript, 4000);
    // If it returns ERROR: TIMEOUT or ERROR: context destroyed, it means navigation started or alert popped up.
    if (typeof success === 'string' && success.includes('ERROR:') && !success.includes('TIMEOUT') && !success.includes('destroyed')) {
        sendLog(`[Debug] 填寫資訊腳本異常: ${success}`, 'warning');
    }

    // Wait for navigation or potential "Duplicate Login" dialog
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 4. Handle any popup if it appears (e.g. "Duplicate Login", "No pending votes")
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
            const specificBtn = document.getElementById('comfirmDialog_okBtn') || document.getElementById('confirmDialog_okBtn');
            if (specificBtn) {
              setTimeout(() => specificBtn.click(), 50);
              return "DOM_MODAL_CLICKED_BY_ID";
            }

            const okBtn = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"], .swal2-confirm, .btn-primary'))
              .find(el => {
                const text = (el.innerText || el.value || "").trim();
                return ['確認', '確定', 'OK'].some(kw => text.includes(kw)) || text === 'OK';
              });
            
            if (okBtn) {
              setTimeout(() => okBtn.click(), 50);
              return "DOM_MODAL_CLICKED_BY_TEXT";
            }
          }
          await delay(500);
        }
        return "NO_DIALOG_FOUND";
      })()
    `;
    
    const result = await safeExecute(handleLoginDialog, 4000);
    const resultStr = String(result);
    
    if (resultStr.startsWith("DOM_MODAL_CLICKED") || resultStr.startsWith("NATIVE_DIALOG_CAPTURED")) {
      sendLog(`偵測到系統提示 (${resultStr})，已自動點擊「確認」。`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    } else if (resultStr !== "NO_DIALOG_FOUND" && !resultStr.startsWith("ERROR: TIMEOUT") && !resultStr.includes('destroyed')) {
      sendLog(`處理系統提示時發生異常: ${resultStr}`, 'warning');
    }
    
    let currentUrl = webContents.getURL();
    for (let k = 0; k < 5; k++) {
        if (!currentUrl.includes('login') || currentUrl.includes('index')) {
            break;
        }
        await new Promise(r => setTimeout(r, 1000));
        currentUrl = webContents.getURL();
    }
    
    if (currentUrl.includes('login') && !currentUrl.includes('index')) {
        sendLog(`[Debug] 登入後未自動跳轉 (URL: ${currentUrl})，嘗試手動導航至首頁...`, 'warning');
        await webContents.loadURL(CONSTANTS.URLS.INDEX);
        await new Promise(r => setTimeout(r, 3000));
        currentUrl = webContents.getURL();
        
        if (currentUrl.includes('login') && !currentUrl.includes('index')) {
            return false;
        }
    }
    
    return true;
  } catch (err) {
    sendLog(`登入腳本執行錯誤: ${err.message}`, 'error');
    return false;
  }
}

module.exports = { execute };
