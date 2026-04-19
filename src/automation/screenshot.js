const path = require('path');
const fs = require('fs');
const { app } = require('electron');

/**
 * Captures a screenshot of the voting proof page.
 * @param {object} webContents - The Electron webContents instance.
 * @param {string} nationalId - The user's national ID.
 * @param {object} company - The company object containing 'code'.
 * @param {string} outputDir - The base output directory.
 * @returns {string} The absolute path to the saved screenshot.
 */
async function execute(webContents, nationalId, company, outputDir) {
  const baseDir = outputDir || path.join(app.getPath('documents'), '投票證明');
  const dir = path.join(baseDir, nationalId);
  
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  const filename = `${nationalId}_${company.code}.png`;
  const filepath = path.join(dir, filename);

  // Use executeJavaScript to scroll the barcode block into view before capturing
  const rect = await webContents.executeJavaScript(`
    (() => {
      const barcodeContainer = document.querySelector('.is-warning') || 
                               document.querySelector('#barCodeAccountNoAndStockId')?.closest('div');
                               
      if (barcodeContainer) {
        barcodeContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        const r = barcodeContainer.getBoundingClientRect();
        return {
          x: Math.floor(r.x),
          y: Math.floor(r.y),
          width: Math.ceil(r.width),
          height: Math.ceil(r.height)
        };
      }
      return null;
    })()
  `);

  // Wait a bit after scrolling
  await new Promise(resolve => setTimeout(resolve, 500));

  // Capture the entire visible page
  const image = await webContents.capturePage();
  const png = image.toPNG();
  
  fs.writeFileSync(filepath, png);
  
  return filepath;
}

module.exports = { execute };
