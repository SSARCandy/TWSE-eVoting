/**
 * Logout automation logic
 */
const { randomDelay, waitForNavigation, safeExecute } = require('./utils');

async function execute(webContents, sendLog) {
  sendLog('[登出] 執行登出...');

  const logoutScript = `
    (() => {
      window.alert = () => true;
      window.confirm = () => true;

      const doProcessBtn = document.querySelector('button[onclick*="doProcess()"]');
      const isSystemMessagePage = document.querySelector('.c-sysMsg_table') || document.body.innerHTML.includes('SYS_LOGOUT_SUCCESS');
      
      if (doProcessBtn && isSystemMessagePage) {
          setTimeout(() => doProcessBtn.click(), 50);
          return "SYS_MSG_CLICKED";
      }

      const logoutBtn = document.querySelector('.c-header_logout') || 
                        document.querySelector('.c-header__logout') ||
                        document.querySelector('div[onclick*="logOff"]') ||
                        document.querySelector('img[src*="logout"]') ||
                        document.querySelector('.fa-sign-out-alt') ||
                        Array.from(document.querySelectorAll('a, button, div')).find(el => el.innerText.includes('Logout') || el.innerText.includes('登出'));

      if (!logoutBtn) {
        if (doProcessBtn) {
            setTimeout(() => doProcessBtn.click(), 50);
            return "SYS_MSG_CLICKED";
        }
        return "NOT_FOUND";
      }

      setTimeout(() => {
          try { 
            logoutBtn.click(); 
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
          } catch(e) {}
      }, 50);
      
      return "LOGOUT_INITIATED";
    })()
  `;

  const result = await safeExecute(webContents, logoutScript, 4000);
  
  if (result === "NOT_FOUND") {
    sendLog('[系統] 無登出鈕，或已登出。', 'info');
    return;
  }

  if (result === "SYS_MSG_CLICKED") {
    sendLog('[登出] 完成。');
    await waitForNavigation(webContents, 3000);
    return;
  }

  sendLog('[登出] 已觸發，待跳轉...');
  await waitForNavigation(webContents, 5000);
  
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
  const isFinalClicked = await safeExecute(webContents, checkFinalScript, 2000);
  if (isFinalClicked === true) {
    sendLog('[登出] 確認完成。');
    await waitForNavigation(webContents, 3000);
    await randomDelay(200, 400);
  }
}

module.exports = { execute };