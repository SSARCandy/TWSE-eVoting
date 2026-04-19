/**
 * Logout automation logic
 */
const { randomDelay, waitForNavigation } = require('./utils');

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
      // Prevent synchronous alert or confirm from blocking execution
      window.alert = () => { return true; };
      window.confirm = () => { return true; };

      // Special case check: if already on "System Reply Message" page
      const doProcessBtn = document.querySelector('button[onclick*="doProcess()"]');
      const isSystemMessagePage = document.querySelector('.c-sysMsg_table') || document.body.innerHTML.includes('SYS_LOGOUT_SUCCESS');
      
      if (doProcessBtn && isSystemMessagePage) {
          setTimeout(() => doProcessBtn.click(), 50);
          return "SYS_MSG_CLICKED";
      }

      // Try to find Logout button
      const logoutBtn = document.querySelector('.c-header_logout') || 
                        document.querySelector('.c-header__logout') ||
                        document.querySelector('div[onclick*="logOff"]') ||
                        document.querySelector('img[src*="logout"]') ||
                        document.querySelector('.fa-sign-out-alt') ||
                        Array.from(document.querySelectorAll('a, button, div')).find(el => el.innerText.includes('Logout') || el.innerText.includes('登出'));

      if (logoutBtn) {
        setTimeout(() => {
            try { logoutBtn.click(); } catch(e) {}
            
            // Delay 1 second to handle first level confirmation dialog
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
      
      // If only doProcess button exists without system message features
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
    await waitForNavigation(webContents, 3000);
    await randomDelay(300, 500);
  } else if (result === "LOGOUT_INITIATED" || (typeof result === 'string' && result.includes("ERROR:"))) {
    sendLog('[登出] 已觸發登出指令，等待跳轉...');
    await waitForNavigation(webContents, 5000);
    
    // Secondary check after navigation
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
      await waitForNavigation(webContents, 3000);
      await randomDelay(200, 400);
    }
  } else if (result === "NOT_FOUND") {
    sendLog('[系統] 找不到登出按鈕，可能已經登出。', 'info');
  } else {
    sendLog('[警告] 處理登出流程時發生非預期狀況。', 'warning');
  }
}

module.exports = { execute };
