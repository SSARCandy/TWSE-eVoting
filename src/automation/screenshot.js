const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { delay } = require('./utils');

/**
 * Captures a screenshot of the voting proof page.
 * @param {object} webContents - The Electron webContents instance.
 * @param {string} nationalId - The user's national ID.
 * @param {object} company - The company object containing 'code'.
 * @param {string} outputDir - The base output directory.
 * @returns {string} The absolute path to the saved screenshot.
 */
async function execute(webContents, nationalId, company, outputDir, folderStructure = 'by_id', includeCompanyName = false) {
  const baseDir = outputDir || path.join(app.getPath('documents'), '投票證明');
  const dir = folderStructure === 'flat' ? baseDir : path.join(baseDir, nationalId);
  
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  
  let filename = `${nationalId}_${company.code}`;
  if (includeCompanyName && company.name) {
    // Sanitize company name for filesystem
    const safeName = company.name.replace(/[\\\\/:*?"<>|]/g, '_');
    filename += `_${safeName}`;
  }
  filename += '.png';
  
  const filepath = path.join(dir, filename);

  // Use executeJavaScript to scroll the barcode block into view before capturing
  await webContents.executeJavaScript(`
    (() => {
      const barcodeContainer = document.querySelector('.is-warning') || 
                               document.querySelector('#barCodeAccountNoAndStockId')?.closest('div');
                               
      if (barcodeContainer) {
        barcodeContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    })()
  `);

  // Wait a bit after scrolling
  await delay(500);

  // Capture the entire visible page
  let image;
  try {
    image = await webContents.capturePage();
    if (image.isEmpty()) throw new Error('Screenshot empty');
    fs.writeFileSync(filepath, image.toPNG());
  } catch (err) {
    const { BrowserWindow } = require('electron');
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      const isMinimized = win.isMinimized();
      const isVisible = win.isVisible();
      
      let originalOpacity, originalFocusable;
      if (isMinimized || !isVisible) {
        originalOpacity = win.getOpacity();
        originalFocusable = win.isFocusable();
        
        // Prevent stealing focus and make it invisible
        win.setOpacity(0);
        win.setFocusable(false);
      }
      
      if (isMinimized) win.restore();
      if (!isVisible) win.showInactive();
      
      // Wait for rendering surface to be allocated
      await delay(500); 
      
      try {
        image = await webContents.capturePage();
        if (image.isEmpty()) throw new Error('Still empty');
        fs.writeFileSync(filepath, image.toPNG());
      } finally {
        if (isMinimized) win.minimize();
        else if (!isVisible) win.hide();
        
        if (isMinimized || !isVisible) {
          win.setOpacity(originalOpacity);
          win.setFocusable(originalFocusable);
        }
      }
    } else {
      throw err;
    }
  }
  
  return filepath;
}

module.exports = { execute };
