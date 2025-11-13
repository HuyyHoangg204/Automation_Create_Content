const { logger } = require('../logger');
const { connectToBrowserByUserDataDir } = require('./gmailLogin');

/**
 * List all Gems from Gemini sidebar
 * @param {Object} params
 * @param {string} params.userDataDir - Chrome user data directory
 * @param {number} [params.debugPort] - Optional DevTools port
 * @returns {Promise<{status: string, gems: string[], error?: string}>}
 */
async function listGems({ userDataDir, debugPort }) {
  const { browser } = await connectToBrowserByUserDataDir(userDataDir, debugPort);
  let status = 'unknown';
  let gems = [];
  try {
    const page = await browser.newPage();

    await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const host = (() => { try { return new URL(page.url()).hostname; } catch { return ''; } })();
    if (host.includes('accounts.google.com')) {
      status = 'not_logged_in';
      return { status, gems: [] };
    }

    // Wait for sidebar to load
    await new Promise((r) => setTimeout(r, 2000));

    // Extract Gems from sidebar
    gems = await page.evaluate(() => {
      const result = [];
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
      
      // Try bot-list-item first (most specific)
      const botListItems = document.querySelectorAll('bot-list-item');
      if (botListItems.length > 0) {
        for (const item of botListItems) {
          const text = norm(item.textContent || item.innerText || '');
          if (text && 
              text !== 'Gems' && 
              text !== 'Recent' &&
              text !== 'New chat' &&
              !text.toLowerCase().includes('explore gems') &&
              !text.toLowerCase().includes('khám phá gems') &&
              text.length > 0 && 
              text.length < 200) {
            // Check if it's before "Recent" section
            let isInRecent = false;
            let current = item;
            for (let i = 0; i < 10 && current; i++) {
              const siblings = Array.from(current.parentElement?.children || []);
              const currentIndex = siblings.indexOf(current);
              for (let j = currentIndex + 1; j < siblings.length; j++) {
                const siblingText = norm(siblings[j].textContent || siblings[j].innerText || '');
                if (siblingText === 'Recent' || siblingText.toLowerCase() === 'recent') {
                  isInRecent = true;
                  break;
                }
              }
              if (isInRecent) break;
              current = current.parentElement;
            }
            
            if (!isInRecent && !result.includes(text)) {
              result.push(text);
            }
          }
        }
      }
      
      // Fallback: try button.bot-new-conversation-button
      if (result.length === 0) {
        const buttons = document.querySelectorAll('button.bot-new-conversation-button');
        for (const button of buttons) {
          const text = norm(button.textContent || button.innerText || '');
          if (text && 
              text !== 'Gems' && 
              text !== 'Recent' &&
              text !== 'New chat' &&
              !text.toLowerCase().includes('explore') &&
              text.length > 0 && 
              text.length < 200) {
            if (!result.includes(text)) {
              result.push(text);
            }
          }
        }
      }
      
      return result;
    });

    status = 'success';
    return { status, gems };
  } catch (e) {
    logger.error({ err: e, stack: e?.stack }, 'gemini: error listing gems');
    return { status: 'failed', error: e?.message || String(e), gems: [] };
  } finally {
    try { browser.disconnect(); } catch (_) {}
  }
}

module.exports = { listGems };

