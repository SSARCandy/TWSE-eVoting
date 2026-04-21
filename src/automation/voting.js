/**
 * Voting automation logic
 */
const { delay, randomDelay, waitForNavigation } = require('./utils');

/**
 * Grabs the list of companies from the current table.
 * Supports pagination by clicking "Next Page" until exhausted.
 */
async function getCompanyList(webContents, sendLog) {
  const allCompaniesMap = new Map();
  let hasNextPage = true;
  let pageNum = 1;

  while (hasNextPage) {
    sendLog(`[清單] 抓取第 ${pageNum} 頁...`);
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
            if (img && img.src.includes('011')) continue; 
            
            btn.click();
            clickedNext = true;
            break;
        }

        return { list, hasNext: clickedNext };
      })()
    `);

    if (!pageData || !pageData.list) break;

    let addedCount = 0;
    pageData.list.forEach(comp => {
      if (!allCompaniesMap.has(comp.code)) {
        allCompaniesMap.set(comp.code, comp);
        addedCount++;
      }
    });

    if (addedCount === 0) break;

    hasNextPage = pageData.hasNext;
    if (hasNextPage) {
      pageNum++;
      await waitForNavigation(webContents, 6000);
      await randomDelay(1500, 2500);
    }
  }

  return Array.from(allCompaniesMap.values());
}

/**
 * Automates the voting process for a single company.
 */
async function voteForCompany(webContents, company, sendLog, skipClick = false, isStopRequested = () => false) {
  if (isStopRequested()) return;

  if (!skipClick) {
    sendLog(`[投票] 點擊 ${company.name} (${company.code})...`);

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

    if (!clickResult) throw new Error('無法找到或點擊投票按鈕');
    await waitClick;
    if (isStopRequested()) return;
    await randomDelay(1500, 2500);
  }

  sendLog(`[投票] 進入頁面，執行程序...`);

  let pageCount = 0;
  const maxPages = 5;

  while (pageCount < maxPages) {
    if (isStopRequested()) return;

    pageCount++;
    sendLog(`[投票] 處理第 ${pageCount} 頁...`);

    const pageScript = `
      (async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const submitBtn = Array.from(document.querySelectorAll('button')).find(el => 
            el.getAttribute('onclick')?.includes('voteObj.checkMeetingPartner()')
        ) || Array.from(document.querySelectorAll('button, a')).find(el => 
            ['送出', '確認送出', 'confirm'].some(kw => el.innerText.toLowerCase().includes(kw))
        );

        if (submitBtn) {
            submitBtn.click();
            return { type: 'submit', success: true };
        }

        const firstCandidateBox = document.querySelector('#chb1');
        const avgBtn = Array.from(document.querySelectorAll('a')).find(a => a.href?.includes('avarage') || a.href?.includes('average'));
        
        if (firstCandidateBox || avgBtn) {
            if (firstCandidateBox && !firstCandidateBox.checked) {
                firstCandidateBox.click();
            }
            if (avgBtn) {
                avgBtn.click();
                if (typeof avarage === 'function') avarage();
            }
            await sleep(300);
        }

        if (typeof optionAll === 'function') {
            optionAll(0);
        } else {
            const groups = new Set();
            document.querySelectorAll('input[type="radio"]').forEach(r => groups.add(r.name));
            groups.forEach(groupName => {
                const radio = document.querySelector(\`input[name="\${groupName}"][value="1"]\`);
                if (radio) radio.click();
            });
        }
        await sleep(300);

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
    if (!result.success) throw new Error(result.reason || '頁面處理失敗');

    if (result.type === 'submit') {
      sendLog('[投票] 偵測確認頁，點擊送出。');
      await waitNext;
      if (isStopRequested()) return;
      await randomDelay(1500, 3000);
      break; 
    }

    sendLog('[投票] 本頁完成，點擊下一步...');
    await waitNext;
    if (isStopRequested()) return;
    await randomDelay(1500, 3000);
  }

  if (pageCount >= maxPages) throw new Error(`超過最大頁數限制 (${maxPages})`);

  if (isStopRequested()) return;

  const finalCheck = await webContents.executeJavaScript(`
    (() => {
        const text = document.body.innerText;
        return ['成功', '完成', '已收'].some(kw => text.includes(kw));
    })()
  `);
  if (!finalCheck) sendLog(`[警告] 結果不明，請檢查截圖。`, 'warning');

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

    for (let i = 0; i < 20; i++) {
      await delay(500); 
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
        await randomDelay(1500, 3000);
        return { success: true, type: linkResult.type };
      }
    }

    throw new Error('搜尋結果逾時或未找到連結');
  } catch (err) {
    sendLog(`[錯誤] 搜尋 ${stockCode} 失敗: ${err.message}`, 'error');
    throw err;
  }
}

/**
 * Navigates back to the main company list page.
 */
async function navigateBackToList(webContents, sendLog) {
  sendLog('[導航] 返回列表...');
  const returnListScript = `
    (() => {
        const exactBackBtn = document.querySelector('button[name="button2"]') || 
                             Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Back'));
        if (exactBackBtn) {
            exactBackBtn.click();
            return true;
        }
        const backBtn = Array.from(document.querySelectorAll('a, button, input[type="button"], .btn, .c-actBtn')).find(el => {
            const t = (el.innerText || el.value || '').replace(/\\s+/g, '');
            return ['回列表', '回未投票', '回清單', '回查詢', '回股東會', '回上頁', '回前頁', '回上一頁', '回首頁'].some(kw => t.includes(kw));
        });
        if (backBtn) {
            backBtn.click();
            return true;
        }
        return false;
    })()
  `;

  const waitP = waitForNavigation(webContents, 15000);
  try {
    const clickedBack = await webContents.executeJavaScript(returnListScript);
    if (!clickedBack) {
      sendLog('[導航] 無回列表鈕，回上頁...');
      webContents.goBack();
    }
  } catch (e) {
    sendLog(`[導航] 返回失敗: ${e.message}，goBack...`);
    webContents.goBack();
  }

  await waitP;
  await randomDelay(300, 600);
}

module.exports = {
  getCompanyList,
  voteForCompany,
  searchAndNavigate,
  navigateBackToList,
};