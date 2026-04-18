/**
 * 登出自動化邏輯
 */

async function execute(webContents, sendLog) {
  sendLog('正在執行登出程序...');
  
  const logoutScript = `
    (async () => {
      const delay = (ms) => new Promise(r => setTimeout(r, ms));
      
      // 1. 點擊頂部可能的登出圖示或按鈕
      // 根據 LibreAutomate 腳本，它點擊的是一個 IMAGE
      // 在網站中可能是 <img src="...logout..."> 或帶有 logout 相關 class 的元素
      
      // 嘗試尋找包含 "登出" 字樣的按鈕
      let logoutBtn = Array.from(document.querySelectorAll('a, button, div')).find(el => el.innerText.includes('登出'));
      
      // 如果找不到文字，嘗試尋找圖示 (常見於右上角)
      if (!logoutBtn) {
        logoutBtn = document.querySelector('.c-header__logout') || 
                    document.querySelector('img[src*="logout"]') ||
                    document.querySelector('.fa-sign-out-alt');
      }

      if (logoutBtn) {
        logoutBtn.click();
        await delay(1000);
        
        // 2. 處理確認視窗 (通常是 sweetalert 或內建 confirm)
        // LibreAutomate 腳本點擊了兩次 "確認"
        for (let i = 0; i < 2; i++) {
          const confirmBtn = Array.from(document.querySelectorAll('button, a')).find(el => 
            el.innerText === '確認' || el.innerText === '確定' || el.innerText.includes('OK')
          );
          if (confirmBtn) {
            confirmBtn.click();
            await delay(800);
          }
        }
        return true;
      }
      
      return false;
    })()
  `;

  try {
    const success = await webContents.executeJavaScript(logoutScript);
    if (success) {
      sendLog('登出成功。');
    } else {
      sendLog('找不到登出按鈕，可能已經登出或頁面結構改變。', 'info');
    }
  } catch (err) {
    sendLog('登出腳本執行錯誤: ' + err.message, 'error');
  }
}

module.exports = { execute };
