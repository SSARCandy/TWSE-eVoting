/**
 * Voting automation logic
 */
const { randomDelay, waitForNavigation } = require('./utils');

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Grabs the list of companies from the current table.
 * Supports pagination by clicking "Next Page" until exhausted.
 */
async function getCompanyList(webContents, sendLog) {
  const allCompaniesMap = new Map();
  let hasNextPage = true;
  let pageNum = 1;

  while (hasNextPage) {
    sendLog(`[清單] 正在抓取第 ${pageNum} 頁公司清單...`);
    const pageData = await webContents.executeJavaScript(`
      (() => {
        const rows = Array.from(document.querySelectorAll('tr')).filter(row => {
            return Array.from(row.querySelectorAll('a.c-actLink, a.u-link')).some(a => 
                ['投票', '查詢', 'Check', 'Vote'].some(kw => a.innerText.includes(kw))
            );
        });

        const list = rows.map(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length < 1) return null;
            
            const companyInfo = cells[0].innerText.trim().split(/\\s+/);
            const code = companyInfo[0];
            const name = companyInfo.length > 1 ? companyInfo.slice(1).join(' ') : '未知公司';
            
            const links = Array.from(row.querySelectorAll('a.c-actLink, a.u-link'));
            const hasVote = links.some(a => ['投票', 'Vote'].some(kw => a.innerText.includes(kw)));
            
            return {
                code,
                name,
                status: hasVote ? 'pending' : 'voted',
                rowIndex: Array.from(row.parentNode.children).indexOf(row)
            };
        }).filter(c => c !== null);

        let clickedNext = false;
        const validNextBtns = Array.from(document.querySelectorAll('a')).filter(a => {
            const img = a.querySelector('img');
            return (img && img.alt === '下一頁') || a.innerText.includes('下一頁');
        });
        
        for (const btn of validNextBtns) {
            const img = btn.querySelector('img');
            if (img && img.src.includes('011')) continue; // likely disabled
            
            btn.click();
            clickedNext = true;
            break;
        }

        return { list, hasNext: clickedNext };
      })()
    `);

    let addedCount = 0;
    if (pageData && pageData.list) {
      for (const comp of pageData.list) {
        if (!allCompaniesMap.has(comp.code)) {
          allCompaniesMap.set(comp.code, comp);
          addedCount++;
        }
      }
    }

    if (addedCount === 0) {
      break;
    }

    hasNextPage = pageData.hasNext;
    if (hasNextPage) {
      pageNum++;
      await waitForNavigation(webContents, 6000);
      await randomDelay(300, 600);
    }
  }

  return Array.from(allCompaniesMap.values());
}

/**
 * Automates the voting process for a single company.
 */
async function voteForCompany(webContents, company, sendLog, skipClick = false) {
  if (!skipClick) {
    sendLog(`[投票] 正在點擊 ${company.name} (${company.code}) 的投票按鈕...`);

    const waitClick = waitForNavigation(webContents);
    const clickResult = await webContents.executeJavaScript(`
      (() => {
          const row = document.querySelectorAll('tr')[${company.rowIndex}];
          if (!row) return false;
          
          const voteLink = Array.from(row.querySelectorAll('a.c-actLink')).find(a => a.innerText.includes('投票'));
          if (!voteLink) return false;
          
          voteLink.click();
          return true;
      })()
    `);

    if (!clickResult) {
      throw new Error('無法找到或點擊投票按鈕');
    }

    await waitClick;
    await randomDelay(300, 600);
  }

  sendLog(`[投票] 進入投票頁面，正在執行自動投票程序...`);

  let pageCount = 0;
  const maxPages = 10;

  while (pageCount < maxPages) {
    pageCount++;
    sendLog(`[投票] 正在處理第 ${pageCount} 頁...`);

    const pageScript = `
      (async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        
        // 1. Check if on confirmation page (submit button)
        const submitBtn = Array.from(document.querySelectorAll('button')).find(el => 
            el.getAttribute('onclick')?.includes('voteObj.checkMeetingPartner()')
        ) || Array.from(document.querySelectorAll('button, a')).find(el => 
            ['送出', '確認送出', 'confirm'].some(kw => el.innerText.toLowerCase().includes(kw))
        );

        if (submitBtn) {
            submitBtn.click();
            return { type: 'submit', success: true };
        }

        // 2. Handle election proposals (Directors/Supervisors) - Approve All/Average
        const checkAllBox = document.querySelector('input[name="checkAllCandidates"], #checkAllCandidates1');
        const avgBtn = Array.from(document.querySelectorAll('a')).find(a => a.href?.includes('avarage') || a.href?.includes('average'));

        if (checkAllBox || avgBtn) {
            if (checkAllBox) {
                checkAllBox.click();
                if (typeof doCheckAll === 'function') doCheckAll(1);
                await sleep(100);
            }
            if (avgBtn) {
                avgBtn.click();
                if (typeof avarage === 'function') avarage();
            }
            await sleep(300);
        }

        // 3. Handle general proposals - Approve All
        let selectedByOptionAll = false;
        if (typeof optionAll === 'function') {
            optionAll(0); // 0 corresponds to "agree"
            selectedByOptionAll = true;
        }

        if (!selectedByOptionAll) {
            const groups = new Set();
            document.querySelectorAll('input[type="radio"]').forEach(r => groups.add(r.name));
            
            for (const groupName of groups) {
                // targetValue = '1' corresponds to agree/for in most generic voting radios
                const radio = document.querySelector(\`input[name="\${groupName}"][value="1"]\`);
                if (radio) {
                    radio.click();
                }
            }
        }

        await sleep(300);

        // 4. Click next step
        const nextBtn = Array.from(document.querySelectorAll('button')).find(el => 
            el.getAttribute('onclick')?.includes('voteObj.checkVote()')
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

    const waitNext = waitForNavigation(webContents, 10000);
    const result = await webContents.executeJavaScript(pageScript);
    
    if (!result.success) {
      throw new Error(result.reason || '頁面處理失敗');
    }

    if (result.type === 'submit') {
      sendLog('[投票] 偵測到確認頁面，已點擊送出。');
      await waitNext;
      await randomDelay(300, 600);
      break; // End of voting loop
    }
    
    sendLog('[投票] 已完成本頁投票，點擊下一步...');
    await waitNext;
    await randomDelay(300, 600);
  }

  if (pageCount >= maxPages) {
    throw new Error(`超過最大頁數限制 (${maxPages})，可能發生無窮迴圈。`);
  }

  const finalCheck = await webContents.executeJavaScript(`
    (() => {
        const text = document.body.innerText;
        return ['成功', '完成', '已收'].some(kw => text.includes(kw));
    })()
  `);

  if (!finalCheck) {
    sendLog(`[警告] 投票結果頁面未顯示明確成功字樣，請檢查截圖。`, 'warning');
  }

  return true;
}

/**
 * Searches for a specific stock code and clicks the corresponding link.
 */
async function searchAndNavigate(webContents, stockCode, sendLog) {
  const searchScript = `
    (() => {
      const input = document.querySelector('body > div.c-main > div.c-votelist > form > div > fieldset.c-voteform__fieldset.o-fieldset.u-float--left > input') || 
                    document.querySelector('div.c-votelist input') ||
                    document.querySelector('input#searchQuery');
      
      const btn = document.querySelector('body > div.c-main > div.c-votelist > form > div > fieldset.c-voteform__fieldset.o-fieldset.u-float--left > a') ||
                  document.querySelector('.c-actIcon--search') ||
                  document.querySelector('a.search-btn');

      if (!input || !btn) return { success: false, reason: '找不到搜尋元件' };

      input.focus();
      input.value = '${stockCode}';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      btn.click();
      
      return { success: true };
    })()
  `;

  try {
    const result = await webContents.executeJavaScript(searchScript);
    if (!result.success) throw new Error(result.reason);
    
    // Polling for search results (Max ~10s)
    for (let i = 0; i < 20; i++) {
      await delay(500); // Shorten polling delay for search results
      const waitSearchNav = waitForNavigation(webContents, 8000);
      const linkResult = await webContents.executeJavaScript(`
            (() => {
                const rows = Array.from(document.querySelectorAll('tr')).filter(row => row.innerText.includes('${stockCode}'));
                if (rows.length === 0) return null;
                
                const link = Array.from(rows[0].querySelectorAll('a.c-actLink, a.u-link')).find(a => 
                    ['投票', '查詢', 'Vote', 'Check'].some(kw => a.innerText.includes(kw))
                );
                
                if (link) {
                    const type = ['投票', 'Vote'].some(kw => link.innerText.includes(kw)) ? 'vote' : 'query';
                    link.click();
                    return { found: true, type };
                }
                return null;
            })()
        `);
        
      if (linkResult && linkResult.found) {
        await waitSearchNav;
        await randomDelay(300, 600);
        return { success: true, type: linkResult.type };
      }
    }

    throw new Error('搜尋結果逾時或未找到連結');
  } catch (err) {
    sendLog(`[錯誤] 搜尋股號 ${stockCode} 時發生錯誤: ${err.message}`, 'error');
    throw err;
  }
}

module.exports = { getCompanyList, voteForCompany, searchAndNavigate };