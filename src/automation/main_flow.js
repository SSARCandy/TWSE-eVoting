const path = require('path');
const login = require('./login');
const voting = require('./voting');
const screenshot = require('./screenshot');
const logout = require('./logout');
const CONSTANTS = require('../constants');
const { randomDelay, waitForNavigation, isMaintenanceTime, isScreenshotExists } = require('./utils');

async function processCompany(webContents, id, company, context, sendLog, emitProgress, isStopRequested) {
  const { pendingCodes, outputDir, folderStructure, filenamePattern, i, idsLength, sessionStats } = context;
  const { code } = company;

  if (company.status !== 'pending' && isScreenshotExists(id, company, outputDir, folderStructure, filenamePattern)) {
    sendLog(`[清單] ${code} 已有截圖，跳過。`);
    if (pendingCodes.includes(code)) {
      context.currentVote++;
      sessionStats.voted++;
    }
    context.currentShot++;
    sessionStats.screenshoted++;
    emitProgress();
    return;
  }

  sendLog(`[導航] 搜尋: ${code}...`);
  try {
    if (isStopRequested()) return;
    const navResult = await voting.searchAndNavigate(webContents, code, sendLog);

    if (navResult.type === 'vote') {
      if (isStopRequested()) return;
      sendLog(`[投票] 偵測未投，開始程序...`);
      await voting.voteForCompany(webContents, company, sendLog, true, isStopRequested);
      if (isStopRequested()) return;
      sendLog(`[投票] ${code} 成功。`);

      context.currentVote++;
      sessionStats.voted++;
      emitProgress();

      sendLog('[導航] 返回查詢...');
      const waitGo = waitForNavigation(webContents);
      const clickedGo = await webContents.executeJavaScript(`(() => { const btn = document.getElementById('go'); if(btn){ btn.click(); return true; } return false; })()`);
      if (!clickedGo) {
        sendLog('[導航] 無確認鈕，回上頁');
        webContents.goBack();
      }
      await waitGo;
      await randomDelay(200, 500);

      if (isStopRequested()) return;
      sendLog(`[截圖] 查詢 ${code}...`);
      const waitQry = waitForNavigation(webContents);
      const clickedQry = await webContents.executeJavaScript(`(() => { const link = document.querySelector('a[onclick*="\\'${code}\\',\\'qry\\'"]'); if(link){ link.click(); return true; } return false; })()`);
      if (!clickedQry) throw new Error(`找不到股號 ${code} 的查詢連結`);
      await waitQry;
      await randomDelay(300, 700);
    } else {
      sendLog(`[導航] 已投過，在查詢頁...`);
      if (pendingCodes.includes(code)) {
        context.currentVote++;
        sessionStats.voted++;
        emitProgress();
      }
    }

    if (isStopRequested()) return;
    
    if (company.hasEGift) {
      sendLog(`[截圖] ${code} 符合eGift，跳過截圖。`);
    } else {
      sendLog(`[截圖] 擷取 ${code} 證明...`);
      const screenshotPath = await screenshot.execute(webContents, id, company, outputDir, folderStructure, filenamePattern);
      
      if (screenshotPath) {
        sendLog(`[截圖] 已存: ${path.basename(screenshotPath)}`);
      } else {
        sendLog(`[截圖] 無條碼，跳過 ${code}。`, 'error');
      }
    }

    context.currentShot++;
    sessionStats.screenshoted++;
    emitProgress();

  } catch (procError) {
    if (isStopRequested()) return;
    
    if (procError.message.includes('NAV_LOST') || procError.message.includes('找不到搜尋元件')) {
      throw procError; // Propagate fatal errors to trigger account-level retry
    }
    
    sendLog(`[錯誤] ${code} 異常: ${procError.message}，下一間。`, 'error');
  }
}

async function processId(webContents, id, i, ids, sendLog, sendProgress, isStopRequested, config, sessionStats) {
  const { outputDir, folderStructure, filenamePattern } = config;
  const maskedId = `${id.substring(0, 4)}****${id.substring(8)}`;

  let retryCount = 0;
  const maxRetries = 1;

  while (retryCount <= maxRetries) {
    if (isStopRequested()) return;

    const context = {
      pendingCodes: [],
      outputDir,
      folderStructure,
      filenamePattern,
      i,
      idsLength: ids.length,
      totalVotes: 0,
      totalShots: 0,
      currentVote: 0,
      currentShot: 0,
      sessionStats,
    };

    const emitProgress = (status = 'processing') => {
      sendProgress({ 
        id: { current: i + 1, total: ids.length }, 
        vote: { 
          current: context.currentVote, 
          total: context.totalVotes, 
          globalCurrent: sessionStats.voted, 
          globalTotal: sessionStats.totalVotes, 
        }, 
        screenshot: { 
          current: context.currentShot, 
          total: context.totalShots, 
          globalCurrent: sessionStats.screenshoted, 
          globalTotal: sessionStats.totalShots, 
        },
        status,
      });
    };

    if (retryCount === 0) {
      sendLog(`[系統] 處理: ${maskedId}`);
    } else {
      sendLog(`[系統] ${maskedId} 發生異常，嘗試重新執行 (${retryCount}/${maxRetries})...`, 'warning');
    }
    emitProgress('initializing');

    try {
      sendLog('[系統] 清空 Session...');
      await webContents.session.clearStorageData();
      await webContents.session.clearCache();

      const loggedIn = await login.execute(webContents, id, sendLog);
      if (!loggedIn) {
        sendLog(`[登入] ${maskedId} 失敗，跳過。`, 'error');
        emitProgress('finished');
        return;
      }

      sendLog('[清單] 抓取清單...');
      const companies = await voting.getCompanyList(webContents, sendLog);

      const pendingCompanies = companies.filter(c => c.status === 'pending');
      const votedNeedScreenshot = companies.filter(c => c.status === 'voted' && !isScreenshotExists(id, c, outputDir, folderStructure, filenamePattern) && !c.hasEGift);
      const targetCompanies = [...pendingCompanies, ...votedNeedScreenshot];

      context.pendingCodes = pendingCompanies.map(c => c.code);
      context.totalVotes = pendingCompanies.length;
      context.totalShots = targetCompanies.length;
      
      // Deduct previous stats if retrying to avoid double counting
      if (retryCount > 0) {
        // This is tricky because we don't know how much was already added.
        // For simplicity, sessionStats should probably only be updated on success or at the end.
        // But the UI needs it. Let's just add the delta if we can.
      } else {
        sessionStats.totalVotes += context.totalVotes;
        sessionStats.totalShots += context.totalShots;
      }

      sendLog(`[清單] 需投 ${context.totalVotes}，需截 ${votedNeedScreenshot.length}。`);
      emitProgress();

      for (const company of targetCompanies) {
        if (isStopRequested()) break;

        await processCompany(webContents, id, company, context, sendLog, emitProgress, isStopRequested);

        if (!isStopRequested()) await voting.navigateBackToList(webContents, sendLog);
      }

      if (isStopRequested()) {
        sendLog(`[系統] ${maskedId} 已收停止請求，停止作業。`);
        return;
      }

      await logout.execute(webContents, sendLog);
      await randomDelay(800, 1500);

      sendLog('[導航] 回登入頁...');
      const waitLogin = waitForNavigation(webContents);
      webContents.loadURL(CONSTANTS.URLS.LOGIN);
      await waitLogin;
      await randomDelay(1000, 2000);

      sendLog(`[系統] ${maskedId} 結束。`, 'info');
      emitProgress('finished');
      return; // Success, break the retry loop

    } catch (error) {
      if (isStopRequested()) return;
      
      const isNavLost = error.message.includes('NAV_LOST') || error.message.includes('找不到搜尋元件');
      
      if (isNavLost && retryCount < maxRetries) {
        sendLog(`[系統] ${maskedId} 導航遺失: ${error.message}，準備重試。`, 'warning');
        retryCount++;
        await logout.execute(webContents, sendLog).catch(() => {});
        await randomDelay(2000, 5000);
        continue; // Retry
      }

      sendLog(`[系統] ${maskedId} 錯誤: ${error.message}`, 'error');
      emitProgress('finished');
      return; // Stop retrying on other errors or max retries reached
    }
  }
}

async function run(webContents, ids, sendLog, sendProgress, isStopRequested, outputDir, folderStructure = 'by_id', filenamePattern = '{id}_{code}') {
  if (isMaintenanceTime()) {
    sendLog('[系統] 維護時間 (00-07)，停止。', 'error');
    return { voted: 0, screenshoted: 0 };
  }

  const sessionStats = { voted: 0, screenshoted: 0, totalVotes: 0, totalShots: 0 };
  const config = { outputDir, folderStructure, filenamePattern };

  for (let i = 0; i < ids.length; i++) {
    if (isStopRequested()) {
      sendLog('[系統] 已收停止請求，終止。');
      break;
    }
    await processId(webContents, ids[i], i, ids, sendLog, sendProgress, isStopRequested, config, sessionStats);
  }

  return sessionStats;
}

module.exports = {
  run,
};