/**
 * Voting automation logic
 */
const { delay, randomDelay, waitForNavigation, safeExecute } = require('./utils');
const { URLS } = require('../constants');

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
            
            // Prefer hidden input for accuracy (handles English names better)
            // Search row-wide for the input
            const nameInput = row.querySelector('input[id^="stockName_"]');
            let code, name;
            
            if (nameInput) {
                name = nameInput.value.trim();
                code = nameInput.id.replace('stockName_', '');
            } else {
                const text = cells[0].innerText.trim();
                // Match at least 4 digits at start, then optional separator, then name
                const match = text.match(/^(\\d{4,})(?:\\s+|(?=[^\\d]))(.*)$/s);
                if (match) {
                    code = match[1];
                    name = match[2].trim() || '未知公司';
                } else {
                    const companyInfo = text.split(/\\s+/);
                    code = companyInfo[0];
                    name = companyInfo.length > 1 ? companyInfo.slice(1).join(' ') : '未知公司';
                }
            }

            let meetingDate = '';
            if (cells.length > 1) {
                const dateDiv = cells[1].querySelector('div');
                if (dateDiv) {
                    const parts = dateDiv.innerText.trim().split('/');
                    if (parts.length === 3) {
                        meetingDate = parts.join('');
                    }
                }
            }
            
            const links = Array.from(row.querySelectorAll('a.c-actLink, a.u-link'));
            const hasVote = links.some(a => ['投票', 'Vote'].some(kw => a.innerText.includes(kw)));
            
            let hasEGift = false;
            if (cells.length > 4) {
                // innerText of 5th cell contains 'Y' if eGift is eligible
                hasEGift = cells[4].innerText.includes('Y') || cells[4].innerHTML.includes('Y');
            }
            
            return {
                code,
                name,
                meetingDate,
                status: hasVote ? 'pending' : 'voted',
                hasEGift,
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
      await waitForNavigation(webContents);
      await randomDelay(500, 1500);
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
          window.alert = function() { return true; };
          window.confirm = function() { return true; };
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
  const maxPages = 20;
  let submitted = false;

  while (pageCount < maxPages) {
    if (isStopRequested()) return;

    pageCount++;
    sendLog(`[投票] 處理第 ${pageCount} 頁...`);

    const pageScript = `
      (async () => {
        window.alert = function() { return true; };
        window.confirm = function() { return true; };
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

    const waitNext = waitForNavigation(webContents);
    const result = await webContents.executeJavaScript(pageScript);
    if (!result.success) throw new Error(result.reason || '頁面處理失敗');

    if (result.type === 'submit') {
      sendLog('[投票] 偵測確認頁，點擊送出。');
      submitted = true;

      let isNavigated = false;
      waitNext.then(() => isNavigated = true);

      // Check for blocking modal like "您尚未對【...】進行電子投票作業" that prevents navigation after submit
      for (let j = 0; j < 6; j++) {
        if (isNavigated) break;
        const modalText = await safeExecute(webContents, `
          (() => {
            const dialog = document.getElementById('msgDialog');
            if (dialog && dialog.style.display !== 'none' && dialog.offsetHeight > 0) {
              const msg = document.getElementById('msgDialog_msg');
              const btn = document.getElementById('msgDialog_okBtn');
              if (btn) btn.click();
              return msg ? msg.innerText.trim() : '操作被擋截';
            }
            return null;
          })()
        `);
        if (modalText && typeof modalText === 'string' && !modalText.startsWith('ERROR:')) {
          sendLog(`[警告] 彈出提示: ${modalText}`, 'warning');
          // If dialog is dismissed, it might not navigate, but we don't want to abort.
          // Breaking the loop will let it continue, and it will await the navigation (which might timeout if blocked).
        }
        await delay(500);
      }

      await waitNext;
      if (isStopRequested()) return;
      await randomDelay(1500, 3000);
      break;
    }

    sendLog('[投票] 本頁完成，點擊下一步...');

    let isNavigatedNext = false;
    waitNext.then(() => isNavigatedNext = true);

    // Also check for modal after clicking "Next" just in case
    for (let j = 0; j < 6; j++) {
      if (isNavigatedNext) break;
      const modalText = await safeExecute(webContents, `
        (() => {
          const dialog = document.getElementById('msgDialog');
          if (dialog && dialog.style.display !== 'none' && dialog.offsetHeight > 0) {
            const msg = document.getElementById('msgDialog_msg');
            const btn = document.getElementById('msgDialog_okBtn');
            if (btn) btn.click();
            return msg ? msg.innerText.trim() : '操作被擋截';
          }
          return null;
        })()
      `);
      if (modalText && typeof modalText === 'string' && !modalText.startsWith('ERROR:')) {
        sendLog(`[警告] 彈出提示: ${modalText}`, 'warning');
      }
      await delay(500);
    }

    await waitNext;
    if (isStopRequested()) return;
    await randomDelay(1500, 3000);
  }

  if (!submitted && pageCount >= maxPages) throw new Error(`超過最大頁數限制 (${maxPages})`);

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
  await ensureOnListPage(webContents, sendLog);

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
      const waitSearchNav = waitForNavigation(webContents);
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
        let isNavigated = false;
        waitSearchNav.then(() => isNavigated = true);

        // Check for blocking modal like "您尚未對【...】進行電子投票作業"
        for (let j = 0; j < 6; j++) {
          if (isNavigated) break;
          const modalText = await safeExecute(webContents, `
            (() => {
              const dialog = document.getElementById('msgDialog');
              if (dialog && dialog.style.display !== 'none' && dialog.offsetHeight > 0) {
                const msg = document.getElementById('msgDialog_msg');
                const btn = document.getElementById('msgDialog_okBtn');
                if (btn) btn.click();
                return msg ? msg.innerText.trim() : '操作被擋截';
              }
              return null;
            })()
          `);
          if (modalText && typeof modalText === 'string' && !modalText.startsWith('ERROR:')) {
            sendLog(`[警告] 彈出提示: ${modalText}`, 'warning');
            // If dialog is dismissed, it might not navigate, but we don't want to abort.
            // Breaking the loop will let it continue, and it will await the navigation (which might timeout if blocked).
          }
          await delay(500);
        }

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
        const exactBackBtn = document.getElementById('go') ||
                             document.querySelector('button[name="button2"]') || 
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

  try {
    const clickedBack = await webContents.executeJavaScript(returnListScript);
    if (clickedBack) {
      await waitForNavigation(webContents, 8000);
    } else {
      if (!(await isAtListPage(webContents))) {
        sendLog('[導航] 無回列表鈕，嘗試回上頁...');
        const waitP = waitForNavigation(webContents, 5000);
        webContents.goBack();
        await waitP;
      }
    }
  } catch (e) {
    sendLog(`[導航] 返回過程異常: ${e.message}`, 'warning');
  }

  // Soft check, only force redirect if really lost
  await ensureOnListPage(webContents, sendLog, false);
  await randomDelay(200, 400);
}

/**
 * Checks if current page is the list page without logging.
 */
async function isAtListPage(webContents) {
  const checkListScript = `
    (() => {
      // Basic check for search input or the main list container
      return !!(
        document.querySelector('input[id^="stockName_"]') ||
        document.querySelector('div.c-votelist input') || 
        document.querySelector('input#searchQuery') ||
        document.querySelector('body > div.c-main > div.c-votelist > form') ||
        document.querySelector('table tr a.c-actLink')
      );
    })()
  `;
  try {
    return await webContents.executeJavaScript(checkListScript);
  } catch (e) {
    return false;
  }
}

/**
 * Ensures the browser is on the company list page.
 * @param {boolean} forceThrow If true, throws NAV_LOST on failure to trigger retry.
 */
async function ensureOnListPage(webContents, sendLog, forceThrow = true) {
  if (await isAtListPage(webContents)) return true;

  // Try one more goBack if not on list
  const waitP = waitForNavigation(webContents, 4000);
  webContents.goBack();
  const success = await waitP;

  if (success && await isAtListPage(webContents)) return true;

  if (forceThrow) {
    sendLog('[導航] 遺失列表位置，嘗試強制重新導向...', 'warning');
    const waitNav = waitForNavigation(webContents, 10000);
    await webContents.loadURL(URLS.INDEX);
    await waitNav;

    if (await isAtListPage(webContents)) return true;
    throw new Error('NAV_LOST: 無法回到列表頁面');
  }

  return false;
}

module.exports = {
  getCompanyList,
  voteForCompany,
  searchAndNavigate,
  navigateBackToList,
  ensureOnListPage,
};