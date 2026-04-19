/**
 * Utility functions for automation delays and navigation.
 */

/**
 * Returns a randomized delay to simulate human pacing and avoid triggering anti-bot
 * signatures characterized by static interval interactions.
 * 
 * @param {number} min Minimum milliseconds to wait
 * @param {number} max Maximum milliseconds to wait
 * @returns {Promise<void>}
 */
async function randomDelay(min = 400, max = 800) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Halts execution natively until Electron signals that a new page navigation 
 * has finished loading. This replaces arbitrary 2000-3000ms waits that 
 * bottleneck the script.
 * 
 * @param {object} webContents The Electron WebContents instance
 * @param {number} timeoutMs Maximum time to wait before timing out (defaults to 10s)
 * @returns {Promise<boolean>} True if loaded successfully, false if timed out
 */
async function waitForNavigation(webContents, timeoutMs = 10000) {
  return new Promise((resolve) => {
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        webContents.removeListener('did-finish-load', onFinish);
        resolve(false);
      }
    }, timeoutMs);

    const onFinish = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(true);
      }
    };

    webContents.once('did-finish-load', onFinish);
  });
}

module.exports = {
  randomDelay,
  waitForNavigation,
};
