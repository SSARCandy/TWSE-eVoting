/**
 * 登出自動化邏輯
 */

async function execute(webContents, sendLog) {
  sendLog('[登出] 正在執行登出程序...');

  const safeExecute = async (script, timeoutMs = 3000) => {
    try {
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs));
      const execPromise = webContents.executeJavaScript(script);
      return await Promise.race([execPromise, timeoutPromise]);
    } catch (err) {
      return "ERROR: " + err.message;
    }
  };

  const logoutScript = `
    (() => {
      // 預防同步 alert 或 confirm 阻擋執行
      window.alert = () => { return true; };
      window.confirm = () => { return true; };

      // 特例檢查：如果已經是在「系統回覆訊息」頁面
      const doProcessBtn = document.querySelector('button[onclick*="doProcess()"]');
      const isSystemMessagePage = document.querySelector('.c-sysMsg_table') || document.body.innerHTML.includes('SYS_LOGOUT_SUCCESS');
      
      if (doProcessBtn && isSystemMessagePage) {
          setTimeout(() => doProcessBtn.click(), 50);
          return "SYS_MSG_CLICKED";
      }

      // 嘗試尋找 Logout 或 登出 按鈕
      const logoutBtn = document.querySelector('.c-header_logout') || 
                        document.querySelector('.c-header__logout') ||
                        document.querySelector('div[onclick*="logOff"]') ||
                        document.querySelector('img[src*="logout"]') ||
                        document.querySelector('.fa-sign-out-alt') ||
                        Array.from(document.querySelectorAll('a, button, div')).find(el => el.innerText.includes('Logout') || el.innerText.includes('登出'));

      if (logoutBtn) {
        setTimeout(() => {
            try { logoutBtn.click(); } catch(e) {}
            
            // 延遲 1 秒後處理第一層確認對話框
            setTimeout(() => {
                try {
                    const confirmBtn = document.getElementById('comfirmDialog_okBtn') || 
                                       Array.from(document.querySelectorAll('button, a')).find(el => 
                                         ['Confirm', '確認', '確定', 'OK'].some(kw => el.innerText.includes(kw))
                                       );
                    if (confirmBtn) confirmBtn.click();
                    if (typeof window.logOff === 'function') window.logOff();
                } catch(e) {}
            }, 1000);
            
        }, 50);
        
        return "LOGOUT_INITIATED";
      }
      
      // 若只有 doProcess 按鈕但沒有系統訊息特徵
      if (doProcessBtn) {
          setTimeout(() => doProcessBtn.click(), 50);
          return "SYS_MSG_CLICKED";
      }

      return "NOT_FOUND";
    })()
  `;

  const result = await safeExecute(logoutScript, 4000);
  
  if (result === "SYS_MSG_CLICKED") {
    sendLog('[登出] 完成登出程序。');
    await new Promise(r => setTimeout(r, 2000));
  } else if (result === "LOGOUT_INITIATED" || (typeof result === 'string' && result.includes("ERROR:"))) {
    sendLog('[登出] 已觸發登出指令，等待跳轉...');
    await new Promise(r => setTimeout(r, 4000));
    
    // 跳轉後補刀
    const checkFinalScript = `
      (() => {
        const btn = document.querySelector('button[onclick*="doProcess()"]');
        if (btn) {
            setTimeout(() => btn.click(), 50);
            return true;
        }
        return false;
      })()
    `;
    const isFinalClicked = await safeExecute(checkFinalScript, 2000);
    if (isFinalClicked === true) {
        sendLog('[登出] 確認登出完成。');
        await new Promise(r => setTimeout(r, 2000));
    }
  } else if (result === "NOT_FOUND") {
    sendLog('[系統] 找不到登出按鈕，可能已經登出。', 'info');
  } else {
    sendLog('[警告] 處理登出流程時發生非預期狀況。', 'warning');
  }
}

module.exports = { execute };
