/**
 * 登入自動化邏輯
 */

async function execute(webContents, nationalId, sendLog) {
  const loginUrl = 'https://stockservices.tdcc.com.tw/evote/login/shareholder.html';
  
  sendLog('正在跳轉至登入頁面...');
  
  // Use loadURL promise (wait for main frame)
  try {
    await webContents.loadURL(loginUrl);
  } catch (err) {
    sendLog('載入頁面失敗: ' + err.message, 'error');
    return false;
  }
  
  // Faster proactive check for existence of key element
  const ready = await webContents.executeJavaScript(`
    (async () => {
      for (let i = 0; i < 20; i++) { // Max 10s total
        if (document.getElementById('caType') || document.getElementById('pageIdNo')) return true;
        await new Promise(r => setTimeout(r, 500));
      }
      return false;
    })()
  `);

  if (!ready) {
    sendLog('等待登入頁面元件逾時，可能載入過慢或 URL 錯誤。', 'warning');
  }

  sendLog('正在填寫登入資訊...');

  const loginScript = `
    (async () => {
      function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
      
      // 1. 選擇券商網路下單憑證
      const caTypeSelect = document.getElementById('caType');
      if (caTypeSelect) {
        caTypeSelect.value = 'SS'; // 券商網路下單憑證
        caTypeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        // 觸發網站內建的 caTypeChange
        if (typeof window.caTypeChange === 'function') {
          window.caTypeChange();
        }
      }
      await delay(800);

      // 2. 填入身分證字號 / 統編
      // 根據 LibreAutomate 參考與實際觀察，比對 placeholder 或特定 ID
      const idInput = document.querySelector('input[placeholder*="身分證"]') || 
                      document.querySelector('input[placeholder*="統編"]') ||
                      document.querySelector('input.required[placeholder*="身分證"]') || 
                      document.getElementById('pageIdNo') || 
                      document.getElementById('idNo') ||
                      document.querySelector('input[name="idNo"]');
      
      if (idInput) {
        idInput.focus();
        await delay(200);
        idInput.value = '${nationalId}';
        idInput.dispatchEvent(new Event('input', { bubbles: true }));
        idInput.dispatchEvent(new Event('change', { bubbles: true }));
        idInput.dispatchEvent(new Event('blur', { bubbles: true }));
      } else {
        throw new Error('找不到身分證/統編輸入框');
      }
      
      await delay(800);

      // 3. 點擊登入
      const loginBtn = document.getElementById('loginBtn');
      if (loginBtn) {
        loginBtn.click();
        return true;
      } else {
        throw new Error('找不到登入按鈕 (預期 ID: loginBtn)');
      }
    })()
  `;

  try {
    const success = await webContents.executeJavaScript(loginScript);
    if (!success) return false;

    // Wait for navigation or potential "Duplicate Login" dialog
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 4. Handle "Duplicate Login" popup if it appears
    // Text: "本次為重複登入或前次未能正常登出..."
    const handleDuplicateLogin = `
      (async () => {
        const delay = (ms) => new Promise(r => setTimeout(r, ms));
        
        // 1. Force override window.alert and window.confirm just in case it's a native dialog
        window.alert = () => { window.__lastAlert = Date.now(); return true; };
        window.confirm = () => { window.__lastConfirm = Date.now(); return true; };

        // Wait up to 3 seconds for potential modal/alert
        for (let i = 0; i < 6; i++) {
          // Check if native dialog was triggered recently
          if (window.__lastAlert || window.__lastConfirm) {
            return "NATIVE_DIALOG_CAPTURED";
          }

          const dialogText = "重複登入";
          const hasDialog = Array.from(document.querySelectorAll('div, span, p, h1, h2, h3, h4, h5, h6, .modal-body, .swal2-title, .swal2-content'))
            .some(el => el.innerText && el.innerText.includes(dialogText));
          
          if (hasDialog) {
            // Find the "確認" OR "確定" OR "OK" button using multiple strategies
            // Prioritize the specific ID provided by the user: #comfirmDialog_okBtn
            const specificBtn = document.getElementById('comfirmDialog_okBtn') || document.getElementById('confirmDialog_okBtn');
            if (specificBtn) {
              specificBtn.click();
              return "DOM_MODAL_CLICKED_BY_ID";
            }

            const okBtn = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"], .swal2-confirm, .btn-primary'))
              .find(el => {
                const text = (el.innerText || el.value || "").trim();
                return text === '確認' || text === '確定' || text === 'OK' || text.includes('確認') || text.includes('確定');
              });
            
            if (okBtn) {
              okBtn.click();
              return "DOM_MODAL_CLICKED_BY_TEXT";
            }
          }
          await delay(500);
        }
        return "NO_DIALOG_FOUND";
      })()
    `;
    
    const result = await webContents.executeJavaScript(handleDuplicateLogin).catch((e) => "ERROR: " + e.message);
    if (result.startsWith("DOM_MODAL_CLICKED") || result === "NATIVE_DIALOG_CAPTURED") {
      sendLog(`偵測到重複登入提示 (${result})，已自動點擊「確認」。`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    } else if (result !== "NO_DIALOG_FOUND" && !result.startsWith("ERROR")) {
      sendLog(`處理重複登入時發生異常: ${result}`, 'warning');
    }
    
    const currentUrl = webContents.getURL();
    if (currentUrl.includes('login') && !currentUrl.includes('index')) {
        // Still on login page, might have failed
        return false;
    }
    
    return true;
  } catch (err) {
    sendLog('登入腳本執行錯誤: ' + err.message, 'error');
    return false;
  }
}

module.exports = { execute };
