/**
 * 投票自動化邏輯
 */

async function getCompanyList(webContents, sendLog) {
  // 導航到投票清單頁面 (如果登入後沒自動跳過來的話)
  // 假設 URL 是 https://stockservices.tdcc.com.tw/evote/index.html
  
  const listScript = `
    (async () => {
      // 假設待投票清單在一個表格中
      // 選取包含 "待投票" 文字的行或特定表格
      const rows = Array.from(document.querySelectorAll('table tr')).filter(row => {
          return row.innerText.includes('投票') && !row.innerText.includes('已投票');
      });

      return rows.map(row => {
          const cells = row.querySelectorAll('td');
          // 假設: 1欄是代碼, 2欄是名稱, 裡面有 a 標籤
          const link = row.querySelector('a[href*="vote"]');
          return {
              code: cells[0]?.innerText.trim() || '未知',
              name: cells[1]?.innerText.trim() || '未知公司',
              url: link?.href
          };
      }).filter(c => c.url);
    })()
  `;

  try {
    const list = await webContents.executeJavaScript(listScript);
    return list || [];
  } catch (err) {
    sendLog('抓取公司清單錯誤: ' + err.message, 'error');
    return [];
  }
}

async function voteForCompany(webContents, company, preference, sendLog) {
  sendLog(`正在進入 ${company.name} 投票頁面...`);
  await webContents.loadURL(company.url);

  // Wait for page load
  await new Promise(r => setTimeout(r, 2000));

  const voteScript = `
    (async () => {
      function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
      
      // 1. 根據偏好勾選所有選項
      const targetValue = '${preference}' === 'agree' ? '1' : '2'; // 1:同意, 2:反對 (需依實際 DOM 確認)
      
      // 嘗試找尋 radio buttons
      // 選項通常會分案號，所以要跑迴圈
      const groups = new Set();
      document.querySelectorAll('input[type="radio"]').forEach(r => groups.add(r.name));
      
      for (const groupName of groups) {
          const radio = document.querySelector('input[name="' + groupName + '"][value="' + targetValue + '"]');
          if (radio) {
              radio.click();
              await delay(50);
          }
      }

      await delay(500);

      // 2. 點擊送出
      const submitBtn = document.querySelector('button[type="submit"]') || 
                        document.querySelector('input[type="submit"]') ||
                        Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('送出') || b.innerText.includes('確認'));
      
      if (submitBtn) {
          submitBtn.click();
          return true;
      }
      return false;
    })()
  `;

  try {
    const success = await webContents.executeJavaScript(voteScript);
    if (!success) throw new Error('找不到送出按鈕');
    
    // Wait for result page
    await new Promise(r => setTimeout(r, 3000));
    
    // Verify success by checking URL or presence of "成功" text
    const isSuccess = await webContents.executeJavaScript(`
        document.body.innerText.includes('成功') || document.body.innerText.includes('完成')
    `);
    
    if (!isSuccess) {
        sendLog(`[警告] ${company.name} 投票結果不確定，請檢查截圖。`, 'info');
    }

  } catch (err) {
    throw new Error('執行投票腳本時出錯: ' + err.message);
  }
}

module.exports = { getCompanyList, voteForCompany };
