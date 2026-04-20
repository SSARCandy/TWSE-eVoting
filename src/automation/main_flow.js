const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const login = require('./login');
const voting = require('./voting');
const screenshot = require('./screenshot');
const logout = require('./logout');
const CONSTANTS = require('../constants');
const { randomDelay, waitForNavigation } = require('./utils');

function isScreenshotExists(nationalId, code, outputDir, folderStructure = 'by_id') {
  const baseDir = outputDir || path.join(app.getPath('documents'), '投票證明');
  const dir = folderStructure === 'flat' ? baseDir : path.join(baseDir, nationalId);

  if (!fs.existsSync(dir)) return false;

  // Check if any file starts with [nationalId]_[code] to accommodate optional company name in filename
  const files = fs.readdirSync(dir);
  const prefix = `${nationalId}_${code}`;
  return files.some(f => f.startsWith(prefix));
}

function isMaintenanceTime() {
  const taiwanHour = (new Date().getUTCHours() + 8) % 24;
  return taiwanHour >= 0 && taiwanHour < 7;
}

async function navigateBackToList(webContents, sendLog) {
  sendLog('[導航] 準備返回列表頁面...');
  const returnListScript = `
    (() => {
        const exactBackBtn = document.querySelector('button[name="button2"]') || 
                             Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Back'));
        if (exactBackBtn) {
            exactBackBtn.click();
            return true;
        }

        const btns = Array.from(document.querySelectorAll('a, button, input[type="button"], .btn, .c-actBtn'));
        const backBtn = btns.find(el => {
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
      sendLog('[導航] 找不到回列表按鈕，嘗試使用回上一頁...');
      webContents.goBack();
    }
  } catch (e) {
    sendLog(`[導航] 執行返回腳本失敗: ${e.message}，嘗試 goBack...`);
    webContents.goBack();
  }

  await waitP;
  await randomDelay(300, 600);
}

async function processCompany(webContents, id, company, context, sendLog, sendProgress) {
  const { pendingCodes, outputDir, folderStructure, includeCompanyName, i, idsLength, totalVotes, totalShots } = context;
  const { code } = company;

  if (isScreenshotExists(id, code, outputDir, folderStructure)) {
    sendLog(`[清單] 股號 ${code} 已有截圖存檔，跳過。`);
    if (pendingCodes.includes(code)) context.currentVote++;
    context.currentShot++;
    sendProgress({ id: { current: i + 1, total: idsLength }, vote: { current: context.currentVote, total: totalVotes }, screenshot: { current: context.currentShot, total: totalShots } });
    return;
  }

  sendLog(`[導航] 搜尋股號: ${code} ...`);
  try {
    const navResult = await voting.searchAndNavigate(webContents, code, sendLog);

    if (navResult.type === 'vote') {
      sendLog(`[投票] 偵測到未投票，開始執行投票程序...`);
      await voting.voteForCompany(webContents, company, sendLog, true);
      sendLog(`[投票] ${code} 投票成功。`);

      context.currentVote++;
      if (context.sessionStats) context.sessionStats.voted++;
      sendProgress({ id: { current: i + 1, total: idsLength }, vote: { current: context.currentVote, total: totalVotes }, screenshot: { current: context.currentShot, total: totalShots } });

      sendLog('[導航] 準備返回查詢頁面...');
      const waitGo = waitForNavigation(webContents);
      const clickedGo = await webContents.executeJavaScript(`(() => { const btn = document.getElementById('go'); if(btn){ btn.click(); return true; } return false; })()`);
      if (!clickedGo) {
        sendLog('[導航] 找不到確認按鈕，嘗試回上頁');
        webContents.goBack();
      }
      await waitGo;
      await randomDelay(200, 500);

      sendLog(`[截圖] 準備查詢 ${code} 以進行截圖...`);
      const waitQry = waitForNavigation(webContents);
      const clickedQry = await webContents.executeJavaScript(`(() => { const link = document.querySelector('a[onclick*="\\'${code}\\',\\'qry\\'"]'); if(link){ link.click(); return true; } return false; })()`);
      if (!clickedQry) throw new Error(`找不到股號 ${code} 的查詢連結`);
      await waitQry;
      await randomDelay(300, 700);
    } else {
      sendLog(`[導航] 偵測到已投過，已在查詢頁面...`);
      if (pendingCodes.includes(code)) {
        context.currentVote++;
        sendProgress({ id: { current: i + 1, total: idsLength }, vote: { current: context.currentVote, total: totalVotes }, screenshot: { current: context.currentShot, total: totalShots } });
      }
    }

    sendLog(`[截圖] 正在擷取 ${code} 投票證明...`);
    const screenshotPath = await screenshot.execute(webContents, id, company, outputDir, folderStructure, includeCompanyName);
    sendLog(`[截圖] 證明已儲存: ${path.basename(screenshotPath)}`);

    context.currentShot++;
    if (context.sessionStats) context.sessionStats.screenshoted++;
    sendProgress({ id: { current: i + 1, total: idsLength }, vote: { current: context.currentVote, total: totalVotes }, screenshot: { current: context.currentShot, total: totalShots } });

  } catch (procError) {
    sendLog(`[錯誤] 處理股號 ${code} 發生異常: ${procError.message}，將繼續下一間公司。`, 'error');
  }
}

async function processId(webContents, id, i, ids, sendLog, sendProgress, isStopRequested, outputDir, folderStructure, includeCompanyName, sessionStats) {
  const maskedId = `${id.substring(0, 4)}****${id.substring(8)}`;

  sendLog(`[系統] 開始處理身分證: ${maskedId}`);
  sendProgress({ id: { current: i, total: ids.length }, vote: { current: 0, total: 0 }, screenshot: { current: 0, total: 0 } });

  try {
    sendLog('[系統] 正在清空 Session 資訊...');
    await webContents.session.clearStorageData();
    await webContents.session.clearCache();

    const loggedIn = await login.execute(webContents, id, sendLog);
    if (!loggedIn) {
      sendLog(`[登入] ${maskedId} 登入失敗，跳過。`, 'error');
      return;
    }

    sendLog('[清單] 正在抓取公司清單...');
    const companies = await voting.getCompanyList(webContents, sendLog);

    const pendingCompanies = companies.filter(c => c.status === 'pending');
    const votedCompanies = companies.filter(c => c.status === 'voted');
    const votedNeedScreenshot = votedCompanies.filter(c => !isScreenshotExists(id, c.code, outputDir, folderStructure));

    const targetCompanies = [...pendingCompanies, ...votedNeedScreenshot];

    const context = {
      pendingCodes: pendingCompanies.map(c => c.code),
      outputDir,
      folderStructure,
      includeCompanyName,
      i,
      idsLength: ids.length,
      totalVotes: pendingCompanies.length,
      totalShots: targetCompanies.length,
      currentVote: 0,
      currentShot: 0,
      sessionStats,
    };

    sendLog(`[清單] 找到 ${context.totalVotes} 家需投票，${votedNeedScreenshot.length} 家需截圖。`);
    sendProgress({ id: { current: i + 1, total: ids.length }, vote: { current: context.currentVote, total: context.totalVotes }, screenshot: { current: context.currentShot, total: context.totalShots } });

    for (const company of targetCompanies) {
      if (isStopRequested()) break;

      await processCompany(webContents, id, company, context, sendLog, sendProgress);

      if (!isStopRequested()) await navigateBackToList(webContents, sendLog);
    }

    await logout.execute(webContents, sendLog);
    await randomDelay(800, 1500);

    sendLog('[導航] 返回初始登入頁面...');
    const waitLogin = waitForNavigation(webContents);
    webContents.loadURL(CONSTANTS.URLS.LOGIN);
    await waitLogin;
    await randomDelay(1000, 2000);

    sendLog(`[系統] ${maskedId} 處理流程結束。`, 'info');
  } catch (error) {
    sendLog(`[系統] 處理 ${maskedId} 時發生錯誤: ${error.message}`, 'error');
  }
}

async function run(webContents, ids, sendLog, sendProgress, isStopRequested, outputDir, folderStructure = 'by_id', includeCompanyName = false) {
  if (isMaintenanceTime()) {
    sendLog('[系統] 目前為系統維護時間 (00:00~07:00)，停止自動作業。', 'error');
    return { voted: 0, screenshoted: 0 };
  }

  const sessionStats = { voted: 0, screenshoted: 0 };

  for (let i = 0; i < ids.length; i++) {
    if (isStopRequested()) {
      sendLog('[系統] 停止請求已被接收，終止執行。');
      break;
    }
    await processId(webContents, ids[i], i, ids, sendLog, sendProgress, isStopRequested, outputDir, folderStructure, includeCompanyName, sessionStats);
  }

  return sessionStats;
}

module.exports = {
  run,
};
