const path = require('path');
const fs = require('fs');
const { app } = require('electron');

async function execute(webContents, nationalId, company, outputDir) {
  // Use executeJavaScript to find the precise rect of the voting table
  const rect = await webContents.executeJavaScript(`
    (() => {
      // Find the title matching "XX年股東常會議案表決情形"
      const titleEl = Array.from(document.querySelectorAll('div, span, h1, h2, h3, h4, th, td')).find(el => 
        /\\d+年股東常會議案表決情形/.test(el.innerText)
      );

      if (!titleEl) return null;

      // Scroll into view first
      titleEl.scrollIntoView();

      // Usually, the table is a sibling or contained within a parent of the title
      // We'll look for the nearest table or a large div nearby
      let container = titleEl.closest('.c-table') || titleEl.closest('table') || titleEl.parentElement;
      
      // If the parent is too small, go up one more
      if (container && container.offsetWidth < 300) {
        container = container.parentElement;
      }

      if (container) {
        const r = container.getBoundingClientRect();
        return {
          x: Math.floor(r.x),
          y: Math.floor(r.y),
          width: Math.ceil(r.width),
          height: Math.ceil(r.height)
        };
      }
      
      // Fallback: just return the title's rect with some padding
      const r = titleEl.getBoundingClientRect();
      return { x: 0, y: Math.floor(r.y), width: 1200, height: 800 }; 
    })()
  `);

  let image;
  if (rect && typeof rect.x === 'number' && rect.width > 0 && rect.height > 0) {
    // 限制最大高度避免當機
    const safeRect = {
      x: Math.max(0, rect.x),
      y: Math.max(0, rect.y),
      width: Math.min(rect.width, 2000),
      height: Math.min(rect.height, 5000)
    };
    image = await webContents.capturePage(safeRect);
  } else {
    // Fallback to full page if rect detection failed or invalid
    image = await webContents.capturePage();
  }
  
  const png = image.toPNG();
  
  // Save to [outputDir]/[身分證字號]/ or fallback to Documents/投票證明/[身分證字號]/
  let baseDir = outputDir;
  if (!baseDir) {
    const documentsPath = app.getPath('documents');
    baseDir = path.join(documentsPath, '投票證明');
  }
  
  const dir = path.join(baseDir, nationalId);
  
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const sanitizedName = company.name.replace(/[\\\\/:*?"<>|]/g, '_');
  const filename = `${dateStr}_${company.code}_${sanitizedName}_投票證明.png`;
  const filepath = path.join(dir, filename);
  
  fs.writeFileSync(filepath, png);
  return filepath;
}

module.exports = { execute };
