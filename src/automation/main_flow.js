const { session, app } = require('electron');
const path = require('path');
const fs = require('fs');

const login = require('./login');
const voting = require('./voting');
const screenshot = require('./screenshot');
const logout = require('./logout');
const CONSTANTS = require('../constants');

/**
 * Checks if a screenshot for the given company and national ID already exists.
 * @param {string} nationalId - The user's national ID.
 * @param {string} code - The company stock code.
 * @param {string} outputDir - The base output directory.
 * @returns {boolean} True if the screenshot exists, false otherwise.
 */
function isScreenshotExists(nationalId, code, outputDir) {
    const baseDir = outputDir || path.join(app.getPath('documents'), '投票證明');
    const dir = path.join(baseDir, nationalId);
    
    if (!fs.existsSync(dir)) return false;

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `${nationalId}_${dateStr}_${code}.png`;
    
    return fs.existsSync(path.join(dir, filename));
}

/**
 * Checks if the current time is within TDCC's maintenance window (00:00 - 07:00 UTC+8).
 * @returns {boolean} True if it is maintenance time, false otherwise.
 */
function isMaintenanceTime() {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const taiwanHour = (utcHour + 8) % 24;
    return taiwanHour >= 0 && taiwanHour < 7;
}

/**
 * Navigates back to the company list page.
 * @param {object} webContents - The Electron webContents instance.
 * @param {function} sendLog - Function to send logs to the UI.
 */
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
    
    try {
        const clickedBack = await webContents.executeJavaScript(returnListScript);
        if (!clickedBack) {
            sendLog('[導航] 找不到回列表按鈕，嘗試使用回上一頁...');
            await webContents.goBack();
        }
    } catch (e) {
        sendLog(`[導航] 執行返回腳本失敗: ${e.message}，嘗試 goBack...`);
        await webContents.goBack();
    }
    
    await new Promise(r => setTimeout(r, 2000));
}

/**
 * Main execution flow for the automation process.
 */
async function run(webContents, ids, preference, sendLog, sendProgress, isStopRequested, outputDir, stockCodes = null) {
    if (isMaintenanceTime()) {
        sendLog('目前為系統維護時間 (00:00~07:00)，停止自動作業。', 'error');
        return;
    }

    for (let i = 0; i < ids.length; i++) {
        if (isStopRequested()) {
            sendLog('停止請求已被接收，終止執行。');
            break;
        }

        const id = ids[i];
        const maskedId = id.substring(0, 4) + '****' + id.substring(8);
        
        sendLog(`[正在處理] 身分證: ${maskedId}`);
        sendProgress({ currentIdIndex: i, totalIds: ids.length, currentCompanyIndex: 0, totalCompanies: 0 });

        try {
            sendLog('正在清空 Session 資訊...');
            await webContents.session.clearStorageData();
            await webContents.session.clearCache();

            const loggedIn = await login.execute(webContents, id, sendLog);
            if (!loggedIn) {
              sendLog(`[失敗] ${maskedId} 登入失敗，跳過。`, 'error');
              continue;
            }

            let targetCodes = [];
            if (stockCodes && stockCodes.length > 0) {
                targetCodes = stockCodes;
                sendLog(`使用指定股號清單: ${targetCodes.join(', ')}`);
            } else {
                sendLog('正在抓取公司清單...');
                const companies = await voting.getCompanyList(webContents, sendLog);
                
                const pendingCodes = companies.filter(c => c.status === 'pending').map(c => c.code);
                const votedCodes = companies.filter(c => c.status === 'voted').map(c => c.code);
                const votedNeedScreenshot = votedCodes.filter(code => !isScreenshotExists(id, code, outputDir));
                
                targetCodes = [...pendingCodes, ...votedNeedScreenshot];
                sendLog(`找到 ${pendingCodes.length} 家需投票，${votedNeedScreenshot.length} 家需補截圖。共需處理 ${targetCodes.length} 家。`);
            }
            
            for (let j = 0; j < targetCodes.length; j++) {
                if (isStopRequested()) break;

                const code = targetCodes[j];
                sendProgress({ 
                    currentIdIndex: i, 
                    totalIds: ids.length, 
                    currentCompanyIndex: j, 
                    totalCompanies: targetCodes.length 
                });

                if (isScreenshotExists(id, code, outputDir)) {
                    sendLog(`[略過] 股號 ${code} 已有截圖存檔，跳過。`);
                    continue;
                }

                sendLog(`[步驟] 搜尋股號: ${code} ...`);
                
                try {
                    const navResult = await voting.searchAndNavigate(webContents, code, sendLog);
                    
                    if (navResult.type === 'vote') {
                        sendLog(`[投票] 偵測到未投票，開始執行投票程序...`);
                        await voting.voteForCompany(webContents, { code, name: '查詢中', rowIndex: 0 }, preference, sendLog, true);
                        sendLog(`[完成] ${code} 投票成功。`);
                        
                        sendLog('[導航] 準備返回列表頁面...');
                        const clickedGo = await webContents.executeJavaScript(`(() => { const btn = document.getElementById('go'); if(btn){ btn.click(); return true; } return false; })()`);
                        if (!clickedGo) {
                            sendLog('[導航] 找不到 id="go" 按鈕，嘗試回上頁');
                            await webContents.goBack();
                        }
                        await new Promise(r => setTimeout(r, 2000));
                        
                        sendLog(`[查詢] 準備點擊 ${code} 查詢以截圖...`);
                        const clickedQry = await webContents.executeJavaScript(`(() => { const link = document.querySelector('a[onclick*="\\'${code}\\',\\'qry\\'"]'); if(link){ link.click(); return true; } return false; })()`);
                        if (!clickedQry) throw new Error(`找不到股號 ${code} 的查詢連結`);
                        
                        await new Promise(r => setTimeout(r, 2000));
                    } else {
                        sendLog(`[檢視] 偵測到已投過，已在查詢頁面...`);
                    }
                    
                    sendLog(`[截圖] 正在擷取 ${code} 投票證明...`);
                    const screenshotPath = await screenshot.execute(webContents, id, { code, name: '股東會' }, outputDir);
                    sendLog(`[存檔] 截圖已儲存: ${path.basename(screenshotPath)}`);

                } catch (procError) {
                    sendLog(`[錯誤] 處理股號 ${code} 發生異常: ${procError.message}，將繼續下一間公司。`, 'error');
                }

                if (!isStopRequested()) {
                    await navigateBackToList(webContents, sendLog);
                }
            }
            
            await logout.execute(webContents, sendLog);
            await new Promise(r => setTimeout(r, 1500));
            
            sendLog('導航回初始登入頁面...');
            await webContents.loadURL(CONSTANTS.URLS.LOGIN);
            await new Promise(r => setTimeout(r, 1000));

            sendLog(`[完畢] ${maskedId} 處理流程結束。`, 'info');

        } catch (error) {
            sendLog(`[全局錯誤] 處理 ${maskedId} 時發生異常: ${error.message}`, 'error');
        }
    }
}

module.exports = { run };
