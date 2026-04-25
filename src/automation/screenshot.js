const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { delay } = require('./utils');

/**
 * Generates a screenshot filename based on pattern.
 * Pattern supports: {id}, {code}, {name}
 * @param {string} pattern - Filename pattern.
 * @param {string} nationalId - User's national ID.
 * @param {object} company - Company object with 'code' and 'name'.
 * @returns {string} The formatted filename.
 */
function formatFilename(pattern, nationalId, company) {
  if (!pattern) pattern = '{id}_{code}';

  // Sanitize company name: replace forbidden chars and whitespace with underscores
  let safeName = (company.name || '')
    .trim()
    .replace(/[\\/:*?"<>| \t\n\r\f\v\x00-\x1F\x7F]/g, '_');

  // Replace multiple internal underscores with a single one for cleaner names
  safeName = safeName.replace(/_+/g, '_').replace(/^_+|_+$/g, '');

  const nameToUse = safeName || 'noname';

  return pattern
    .replace(/{id}/g, nationalId || 'unknown')
    .replace(/{code}/g, company.code || 'unknown')
    .replace(/{name}/g, nameToUse);
}

/**
 * Captures a screenshot of the voting proof page.
 * @param {object} webContents - The Electron webContents instance.
 * @param {string} nationalId - The user's national ID.
 * @param {object} company - The company object containing 'code'.
 * @param {string} outputDir - The base output directory.
 * @param {string} folderStructure - Folder structure type ('by_id' or 'flat').
 * @param {string} filenamePattern - Pattern for the filename.
 * @returns {string} The absolute path to the saved screenshot.
 */
async function execute(webContents, nationalId, company, outputDir, folderStructure = 'by_id', filenamePattern = '{id}_{code}') {
  const baseDir = outputDir || path.join(app.getPath('documents'), '投票證明');
  const dir = folderStructure === 'flat' ? baseDir : path.join(baseDir, nationalId);

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const filename = `${formatFilename(filenamePattern, nationalId, company)}.png`;
  const filepath = path.join(dir, filename);

  // Use executeJavaScript to scroll the barcode block into view before capturing
  await webContents.executeJavaScript(`
    (() => {
      const barcodeContainer = document.querySelector('.is-warning') || 
                               document.querySelector('#barCodeAccountNoAndStockId')?.closest('div');
                               
      if (barcodeContainer) {
        // Use 'instant' instead of 'smooth' to prevent motion blur during capture
        barcodeContainer.scrollIntoView({ behavior: 'instant', block: 'center' });
      }
    })()
  `);

  // Wait for font rendering to settle after scroll
  await delay(800);

  // Capture the entire visible page
  let image;
  try {
    image = await webContents.capturePage();
    if (image.isEmpty()) throw new Error('Screenshot empty');
  } catch (err) {
    const { BrowserWindow } = require('electron');
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw err;

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
    } finally {
      if (isMinimized) win.minimize();
      else if (!isVisible) win.hide();

      if (isMinimized || !isVisible) {
        win.setOpacity(originalOpacity);
        win.setFocusable(originalFocusable);
      }
    }
  }

  fs.writeFileSync(filepath, image.toPNG());
  return filepath;
}

module.exports = { execute, formatFilename };
