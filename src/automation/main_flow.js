const path = require('path');
const login = require('./login');
const voting = require('./voting');
const screenshot = require('./screenshot');
const logout = require('./logout');
const CONSTANTS = require('../constants');
const { randomDelay, waitForNavigation, isMaintenanceTime, isScreenshotExists } = require('./utils');

async function processCompany(webContents, id, company, context, sendLog, sendProgress) {
  const { pendingCodes, outputDir, folderStructure, includeCompanyName, i, idsLength, totalVotes, totalShots } = context;
  const { code } = company;

  if (isScreenshotExists(id, code, outputDir, folderStructure)) {
    sendLog(`[清單] ${code} 已有截圖，跳過。`);
    if (pendingCodes.includes(code)) context.currentVote++;
    context.currentShot++;
    sendProgress({ 
      id: { current: i + 1, total: idsLength }, 
      vote: { current: context.currentVote, total: totalVotes }, 
      screenshot: { current: context.currentShot, total: totalShots }, 
    });
    return;
  }

  sendLog(`[導航] 搜尋: ${code}...`);
  try {
    const navResult = await voting.searchAndNavigate(webContents, code, sendLog);

    if (navResult.type === 'vote') {
      sendLog(`[投票] 偵測未投，開始程序...`);
      await voting.voteForCompany(webContents, company, sendLog, true);
      sendLog(`[投票] ${code} 成功。`);

      context.currentVote++;
      if (context.sessionStats) context.sessionStats.voted++;
      sendProgress({ 
        id: { current: i + 1, total: idsLength }, 
        vote: { current: context.currentVote, total: totalVotes }, 
        screenshot: { current: context.currentShot, total: totalShots }, 
      });

      sendLog('[導航] 返回查詢...');
      const waitGo = waitForNavigation(webContents);
      const clickedGo = await webContents.executeJavaScript(`(() => { const btn = document.getElementById('go'); if(btn){ btn.click(); return true; } return false; })()`);
      if (!clickedGo) {
        sendLog('[導航] 無確認鈕，回上頁');
        webContents.goBack();
      }
      await waitGo;
      await randomDelay(200, 500);

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
        sendProgress({ 
          id: { current: i + 1, total: idsLength }, 
          vote: { current: context.currentVote, total: totalVotes }, 
          screenshot: { current: context.currentShot, total: totalShots }, 
        });
      }
    }

    sendLog(`[截圖] 擷取 ${code} 證明...`);
    const screenshotPath = await screenshot.execute(webContents, id, company, outputDir, folderStructure, includeCompanyName);
    sendLog(`[截圖] 已存: ${path.basename(screenshotPath)}`);

    context.currentShot++;
    if (context.sessionStats) context.sessionStats.screenshoted++;
    sendProgress({ 
      id: { current: i + 1, total: idsLength }, 
      vote: { current: context.currentVote, total: totalVotes }, 
      screenshot: { current: context.currentShot, total: totalShots }, 
    });

  } catch (procError) {
    sendLog(`[錯誤] ${code} 異常: ${procError.message}，下一間。`, 'error');
  }
}

async function processId(webContents, id, i, ids, sendLog, sendProgress, isStopRequested, config, sessionStats) {
  const { outputDir, folderStructure, includeCompanyName } = config;
  const maskedId = `${id.substring(0, 4)}****${id.substring(8)}`;

  sendLog(`[系統] 處理: ${maskedId}`);
  sendProgress({ id: { current: i, total: ids.length }, vote: { current: 0, total: 0 }, screenshot: { current: 0, total: 0 } });

  try {
    sendLog('[系統] 清空 Session...');
    await webContents.session.clearStorageData();
    await webContents.session.clearCache();

    const loggedIn = await login.execute(webContents, id, sendLog);
    if (!loggedIn) {
      sendLog(`[登入] ${maskedId} 失敗，跳過。`, 'error');
      return;
    }

    sendLog('[清單] 抓取清單...');
    const companies = await voting.getCompanyList(webContents, sendLog);

    const pendingCompanies = companies.filter(c => c.status === 'pending');
    const votedNeedScreenshot = companies.filter(c => c.status === 'voted' && !isScreenshotExists(id, c.code, outputDir, folderStructure));
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

    sendLog(`[清單] 需投 ${context.totalVotes}，需截 ${votedNeedScreenshot.length}。`);
    sendProgress({ 
      id: { current: i + 1, total: ids.length }, 
      vote: { current: context.currentVote, total: context.totalVotes }, 
      screenshot: { current: context.currentShot, total: context.totalShots }, 
    });

    for (const company of targetCompanies) {
      if (isStopRequested()) break;

      await processCompany(webContents, id, company, context, sendLog, sendProgress);

      if (!isStopRequested()) await voting.navigateBackToList(webContents, sendLog);
    }

    await logout.execute(webContents, sendLog);
    await randomDelay(800, 1500);

    sendLog('[導航] 回登入頁...');
    const waitLogin = waitForNavigation(webContents);
    webContents.loadURL(CONSTANTS.URLS.LOGIN);
    await waitLogin;
    await randomDelay(1000, 2000);

    sendLog(`[系統] ${maskedId} 結束。`, 'info');
  } catch (error) {
    sendLog(`[系統] ${maskedId} 錯誤: ${error.message}`, 'error');
  }
}

async function run(webContents, ids, sendLog, sendProgress, isStopRequested, outputDir, folderStructure = 'by_id', includeCompanyName = false) {
  if (isMaintenanceTime()) {
    sendLog('[系統] 維護時間 (00-07)，停止。', 'error');
    return { voted: 0, screenshoted: 0 };
  }

  const sessionStats = { voted: 0, screenshoted: 0 };
  const config = { outputDir, folderStructure, includeCompanyName };

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