const { session } = require('electron');
const login = require('./login');
const voting = require('./voting');
const screenshot = require('./screenshot');
const logout = require('./logout');

async function run(webContents, ids, preference, sendLog, sendProgress, isStopRequested, outputDir, stockCodes = null) {
    for (let i = 0; i < ids.length; i++) {
        if (isStopRequested()) {
            sendLog('停止請求已被接收，終止執行。');
            break;
        }

        const id = ids[i];
        const maskedId = id.substring(0, 4) + '****' + id.substring(8);
        
        // 0. Maintenance Check (00:00 - 07:00 Taiwan Time UTC+8)
        const now = new Date();
        // Calculate Taiwan hour (UTC+8)
        const utcHour = now.getUTCHours();
        const taiwanHour = (utcHour + 8) % 24;
        
        if (taiwanHour >= 0 && taiwanHour < 7) {
            sendLog('目前為系統維護時間 (00:00~07:00)，停止自動作業。', 'error');
            break;
        }

        sendLog(`[正在處理] 身分證: ${maskedId}`);
        sendProgress({ currentIdIndex: i, totalIds: ids.length, currentCompanyIndex: 0, totalCompanies: 0 });

        try {
            // 1. Clear Session for isolation
            sendLog('正在清空 Session 資訊...');
            await webContents.session.clearStorageData();
            await webContents.session.clearCache();

            // 2. Login
            const loggedIn = await login.execute(webContents, id, sendLog);
            if (!loggedIn) {
              sendLog(`[失敗] ${maskedId} 登入失敗，跳過。`, 'error');
              continue;
            }

            // 3. Determine companies to process
            let targetCodes = [];
            if (stockCodes && stockCodes.length > 0) {
                targetCodes = stockCodes;
                sendLog(`使用指定股號清單: ${targetCodes.join(', ')}`);
            } else {
                sendLog('正在抓取待投票公司清單...');
                const companies = await voting.getCompanyList(webContents, sendLog);
                targetCodes = companies.map(c => c.code);
                sendLog(`找到 ${targetCodes.length} 家公司需要處理。`);
            }
            
            // 4. Process each company using Search-based logic for reliability
            for (let j = 0; j < targetCodes.length; j++) {
                if (isStopRequested()) break;

                const code = targetCodes[j];
                sendProgress({ 
                    currentIdIndex: i, 
                    totalIds: ids.length, 
                    currentCompanyIndex: j, 
                    totalCompanies: targetCodes.length 
                });

                sendLog(`[步驟] 搜尋股號: ${code} ...`);
                
                try {
                    // Navigate to search results for this stock
                    const navResult = await voting.searchAndNavigate(webContents, code, sendLog);
                    
                    if (navResult.type === 'vote') {
                        sendLog(`[投票] 偵測到未投票，開始執行投票程序...`);
                        await voting.voteForCompany(webContents, { code: code, name: '查詢中', rowIndex: 0 }, preference, sendLog, true);
                        sendLog(`[完成] ${code} 投票成功。`);
                    } else {
                        sendLog(`[檢視] 偵測到已投過，直接進行截圖存證...`);
                    }
                    
                    // 5. Screenshot (Precise detection)
                    sendLog(`[截圖] 正在擷取 ${code} 投票證明...`);
                    const screenshotPath = await screenshot.execute(webContents, id, { code: code, name: '股東會' }, outputDir);
                    sendLog(`[存檔] 截圖已儲存: ${screenshotPath.split('\\').pop()}`);

                    // Delay between companies
                    await new Promise(r => setTimeout(r, 1500));
                    
                    // Return to list for next search
                    await webContents.loadURL('https://stockservices.tdcc.com.tw/evote/index.html');
                    await new Promise(r => setTimeout(r, 2000));

                } catch (procError) {
                    sendLog(`[致命錯誤] 偵測到異常且已停止執行: ${procError.message}`, 'error');
                    // 丟出錯誤以終止整個 run 迴圈，方便使用者偵錯
                    throw procError;
                }
            }
            
            // 6. Logout
            await logout.execute(webContents, sendLog);
            sendLog(`[完畢] ${maskedId} 處理流程結束。`, 'info');

        } catch (error) {
            sendLog(`[全局錯誤] 處理 ${maskedId} 時發生異常: ${error.message}`, 'error');
        }
    }
}

module.exports = { run };
