const { session } = require('electron');
const login = require('./login');
const voting = require('./voting');
const screenshot = require('./screenshot');

async function run(webContents, ids, preference, sendLog, sendProgress, isStopRequested) {
    for (let i = 0; i < ids.length; i++) {
        if (isStopRequested()) {
            sendLog('停止請求已被接收，終止執行。');
            break;
        }

        const id = ids[i];
        const maskedId = id.substring(0, 4) + '****' + id.substring(8);
        
        // 0. Maintenance Check (00:00 - 07:00 Taiwan Time UTC+8)
        const now = new Date();
        const utcHours = now.getUTCHours();
        const taiwanHours = (utcHours + 8) % 24;
        if (taiwanHours >= 0 && taiwanHours < 7) {
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

            // 3. Get Company List
            const companies = await voting.getCompanyList(webContents, sendLog);
            sendLog(`找到 ${companies.length} 家待投票公司。`);
            
            // 4. Vote for each company
            for (let j = 0; j < companies.length; j++) {
                if (isStopRequested()) break;

                const company = companies[j];
                sendProgress({ 
                    currentIdIndex: i, 
                    totalIds: ids.length, 
                    currentCompanyIndex: j, 
                    totalCompanies: companies.length 
                });

                sendLog(`[投票中] ${company.name} (${company.code}) ...`);
                
                try {
                    await voting.voteForCompany(webContents, company, preference, sendLog);
                    
                    // 5. Screenshot
                    sendLog(`[完成] ${company.name} 投票成功，正在截圖...`);
                    const screenshotPath = await screenshot.execute(webContents, id, company);
                    sendLog(`[存檔] 截圖已儲存至: ${screenshotPath}`);

                    // Delay between companies
                    await new Promise(r => setTimeout(r, 2000));
                    
                } catch (voteError) {
                    sendLog(`[錯誤] ${company.name} 投票失敗: ${voteError.message}`, 'error');
                }
            }
            
            sendLog(`[完畢] ${maskedId} 所有公司處理完成。`, 'info');

        } catch (error) {
            sendLog(`[全局錯誤] 處理 ${maskedId} 時發生錯誤: ${error.message}`, 'error');
        }
    }
}

module.exports = { run };
