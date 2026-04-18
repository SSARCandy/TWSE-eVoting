/**
 * 投票自動化邏輯
 */

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getCompanyList(webContents, sendLog) {
  const listScript = `
    (() => {
      // 尋找包含公司列表的表格行
      const rows = Array.from(document.querySelectorAll('tr')).filter(row => {
          const text = row.innerText;
          // 必須包含 "未投票" 且有 "投票" 連結
          return text.includes('未投票') && Array.from(row.querySelectorAll('a.c-actLink')).some(a => a.innerText.includes('投票'));
      });

      return rows.map(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length < 1) return null;
          
          // 第一欄通常是 "證券代號公司簡稱"，例如 "8033 雷虎"
          const companyInfo = cells[0].innerText.trim().split(/\\s+/);
          const code = companyInfo[0];
          const name = companyInfo.length > 1 ? companyInfo.slice(1).join(' ') : '未知公司';
          
          return {
              code: code,
              name: name,
              rowIndex: Array.from(row.parentNode.children).indexOf(row)
          };
      }).filter(c => c !== null);
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

async function voteForCompany(webContents, company, preference, sendLog, skipClick = false) {
  if (!skipClick) {
    sendLog(`正在點擊 ${company.name} (${company.code}) 的投票按鈕...`);

  // 1. 點擊列表中的投票按鈕
  const clickResult = await webContents.executeJavaScript(`
    (() => {
        const rows = document.querySelectorAll('tr');
        const row = rows[${company.rowIndex}];
        if (row) {
            const voteLink = Array.from(row.querySelectorAll('a.c-actLink')).find(a => a.innerText.includes('投票'));
            if (voteLink) {
                voteLink.click();
                return true;
            }
        }
        return false;
    })()
  `);

    if (!clickResult) {
      throw new Error('無法找到或點擊投票按鈕');
    }

    // 等待頁面跳轉
    await delay(3000);
  }

  sendLog(`進入投票頁面，正在執行自動投票程序 (偏好: ${preference})...`);

  let pageCount = 0;
  const maxPages = 10;
  let finished = false;

  while (pageCount < maxPages && !finished) {
    pageCount++;
    sendLog(`[投票] 正在處理第 ${pageCount} 頁...`);

    // 執行頁面投票與導航邏輯
    const pageScript = `
      (async () => {
        const delay = (ms) => new Promise(r => setTimeout(r, ms));
        
        // 1. 檢查是否在「確認頁面」(具有送出按鈕)
        const submitBtn = Array.from(document.querySelectorAll('button')).find(el => 
            el.getAttribute('onclick') && el.getAttribute('onclick').includes('voteObj.checkMeetingPartner()')
        ) || Array.from(document.querySelectorAll('button, a')).find(el => 
            el.innerText.includes('送出') || el.innerText.includes('確認送出') || el.innerText.toLowerCase().includes('confirm')
        );

        if (submitBtn) {
            submitBtn.click();
            return { type: 'submit', success: true };
        }

        // 2. 如果不是確認頁面，則嘗試填寫投票內容
        
        // 2a. 處理候選人/選舉部分 (董事/監察人選舉)
        const checkAllBox = document.querySelector('input[name="checkAllCandidates"], #checkAllCandidates1');
        const avgBtn = Array.from(document.querySelectorAll('a')).find(a => a.href && (a.href.includes('avarage') || a.href.includes('average')));
        const giveUpBtn = Array.from(document.querySelectorAll('a')).find(a => a.href && a.href.includes('giveUp'));

        if (checkAllBox || avgBtn || giveUpBtn) {
            if ('${preference}' === 'agree') {
                if (checkAllBox) {
                    checkAllBox.click();
                    if (typeof doCheckAll === 'function') doCheckAll(1);
                    await delay(300);
                }
                if (avgBtn) {
                    avgBtn.click();
                    if (typeof avarage === 'function') avarage();
                }
            } else {
                if (giveUpBtn) {
                    giveUpBtn.click();
                    if (typeof giveUp === 'function') giveUp();
                }
            }
            await delay(500);
        }

        // 2b. 處理一般議案 (Radios / optionAll)
        let selectedByOptionAll = false;
        if (typeof optionAll === 'function') {
            if ('${preference}' === 'agree') {
                optionAll(0);
                selectedByOptionAll = true;
            } else if ('${preference}' === 'against' || '${preference}' === 'disagree') {
                optionAll(1);
                selectedByOptionAll = true;
            } else if ('${preference}' === 'abstained') {
                optionAll(2);
                selectedByOptionAll = true;
            }
        }

        if (!selectedByOptionAll) {
            const groups = new Set();
            document.querySelectorAll('input[type="radio"]').forEach(r => groups.add(r.name));
            if (groups.size > 0) {
                for (const groupName of groups) {
                    let targetValue = '1'; 
                    if ('${preference}' === 'random') {
                        targetValue = Math.floor(Math.random() * 3 + 1).toString();
                    } else if ('${preference}' === 'against' || '${preference}' === 'disagree') {
                        targetValue = '2';
                    } else if ('${preference}' === 'abstained') {
                        targetValue = '3';
                    }
                    const radio = document.querySelector('input[name="' + groupName + '"][value="' + targetValue + '"]');
                    if (radio) {
                        radio.click();
                        await delay(50);
                    }
                }
            }
        }

        await delay(500);

        // 3. 點擊「下一步」
        const nextBtn = Array.from(document.querySelectorAll('button')).find(el => 
            el.getAttribute('onclick') && el.getAttribute('onclick').includes('voteObj.checkVote()')
        ) || Array.from(document.querySelectorAll('button, a')).find(el => 
            el.innerText.includes('下一步') || el.innerText.toLowerCase().includes('next')
        );

        if (nextBtn) {
            nextBtn.click();
            return { type: 'next', success: true };
        }

        return { type: 'none', success: false, reason: '找不到下一步或送出按鈕' };
      })()
    `;

    const result = await webContents.executeJavaScript(pageScript);
    
    if (!result.success) {
      throw new Error(result.reason || '頁面處理失敗');
    }

    if (result.type === 'submit') {
      sendLog('偵測到確認頁面，已點擊「送出」。');
      finished = true;
    } else {
      sendLog('已完成本頁投票，點擊「下一步」...');
      await delay(3000); // 等待下一頁載入
    }
  }

  if (!finished) {
    throw new Error(`超過最大頁數限制 (${maxPages})，可能發生無窮迴圈。`);
  }

  // 等待最後結果
  await delay(3000);

  // 驗證是否成功
  const finalCheck = await webContents.executeJavaScript(`
    (() => {
        const text = document.body.innerText;
        return text.includes('成功') || text.includes('完成') || text.includes('已收');
    })()
  `);

  if (!finalCheck) {
    sendLog(`[警告] 投票結果頁面未顯示明確成功字樣，請檢查截圖。`, 'info');
  }

  return true;
}


async function searchAndNavigate(webContents, stockCode, sendLog) {
  sendLog(`[Debug] 開始搜尋股號 ${stockCode} ...`);

  const searchScript = `
    (() => {
      // 1. 尋找搜尋框與按鈕
      const input = document.querySelector('body > div.c-main > div.c-votelist > form > div > fieldset.c-voteform__fieldset.o-fieldset.u-float--left > input') || 
                    document.querySelector('div.c-votelist input') ||
                    document.querySelector('input#searchQuery');
      
      const btn = document.querySelector('body > div.c-main > div.c-votelist > form > div > fieldset.c-voteform__fieldset.o-fieldset.u-float--left > a') ||
                  document.querySelector('.c-actIcon--search') ||
                  document.querySelector('a.search-btn');

      if (!input || !btn) return { success: false, reason: '找不到搜尋元件 (' + (input?'按鈕':'框') + '缺失)' };

      // 2. 填寫並點擊
      input.focus();
      input.value = '${stockCode}';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      
      // 模擬點擊
      btn.click();
      
      return { success: true };
    })()
  `;

  try {
    sendLog(`[Debug] 正在送出搜尋指令...`);
    const result = await webContents.executeJavaScript(searchScript);
    if (!result.success) throw new Error(result.reason);

    sendLog(`[Debug] 搜尋已送出，等待結果...`);
    
    // 在 Node.js 端進行輪詢檢查結果
    for (let i = 0; i < 10; i++) {
        await delay(1000);
        const findLinkScript = `
            (() => {
                const rows = Array.from(document.querySelectorAll('tr')).filter(row => row.innerText.includes('${stockCode}'));
                if (rows.length === 0) return null;
                const link = Array.from(rows[0].querySelectorAll('a.c-actLink, a.u-link')).find(a => 
                    a.innerText.includes('投票') || a.innerText.includes('查詢') || a.innerText.includes('Vote')
                );
                if (link) {
                    const type = (link.innerText.includes('投票') || link.innerText.includes('Vote')) ? 'vote' : 'query';
                    link.click();
                    return { found: true, type: type };
                }
                return null;
            })()
        `;
        
        const linkResult = await webContents.executeJavaScript(findLinkScript);
        if (linkResult && linkResult.found) {
            sendLog(`[Debug] 找到連結並已點擊: \${linkResult.type}`);
            await delay(3500);
            return { success: true, type: linkResult.type };
        }
    }

    throw new Error('搜尋結果逾時或未找到連結');
  } catch (err) {
    sendLog(`[錯誤] 搜尋股號 ${stockCode} 異常: ${err.message}`, 'error');
    throw err;
  }
}

module.exports = { getCompanyList, voteForCompany, searchAndNavigate };
