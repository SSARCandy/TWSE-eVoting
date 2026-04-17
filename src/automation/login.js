/**
 * 登入自動化邏輯
 */

async function execute(webContents, nationalId, sendLog) {
  const loginUrl = 'https://stockservices.tdcc.com.tw/evote/login/shareholder.html';
  
  sendLog('正在跳轉至登入頁面...');
  await webContents.loadURL(loginUrl);
  
  // Wait for page to load
  await new Promise((resolve) => {
    const finishHandler = () => {
      webContents.removeListener('did-finish-load', finishHandler);
      resolve();
    };
    webContents.on('did-finish-load', finishHandler);
    
    // Safety timeout
    setTimeout(finishHandler, 10000);
  });

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

      // 2. 填入身分證字號
      // 根據實際觀察，此欄位沒有 ID，需使用 placeholder 或 class 定位
      const idInput = document.querySelector('input.required[placeholder*="身分證"]') || 
                      document.querySelector('input[placeholder*="身分證字號"]') ||
                      document.getElementById('pageIdNo') || 
                      document.getElementById('idNo');
      
      if (idInput) {
        idInput.focus();
        await delay(200);
        idInput.value = '${nationalId}';
        idInput.dispatchEvent(new Event('input', { bubbles: true }));
        idInput.dispatchEvent(new Event('change', { bubbles: true }));
        idInput.dispatchEvent(new Event('blur', { bubbles: true }));
      } else {
        throw new Error('找不到身分證輸入框 (預期: input.required)');
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

    // Wait for navigation and verify login
    // Usually redirects to /evote/index.html or similar
    await new Promise(resolve => setTimeout(resolve, 3000));
    
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
