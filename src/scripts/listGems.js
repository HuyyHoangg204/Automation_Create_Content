const { connectToBrowserByUserDataDir } = require('./gmailLogin');
const { clickSelectors, clickByText } = require('./gemini');

/**
 * List all Gems from Gemini Gem manager page
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

    // Wait for page to load
    await new Promise((r) => setTimeout(r, 2000));

    // Click "Explore Gems" button to open Gem manager
    const clickedExplore = await clickSelectors(page, [
      'button[aria-label="Explore Gems"]',
      'button[aria-label*="Explore Gems" i]',
      '[aria-label="Explore Gems"]',
    ], { timeoutMs: 12000 }) || await clickByText(page, ['Explore Gems', 'Khám phá Gems'], { timeoutMs: 8000 });

    if (!clickedExplore) {
      status = 'explore_button_not_found';
      return { status, gems: [] };
    }

    // Wait for navigation to Gem manager page
    await Promise.race([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
      new Promise((r) => setTimeout(r, 2000)),
    ]);

    // Wait for Gem manager page to load
    await new Promise((r) => setTimeout(r, 2000));

    // Extract Gems from Gem manager page - mỗi gem là 1 bot-list-row
    gems = await page.evaluate(() => {
      const result = [];
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
      
      // Tìm container "Your Gems" bằng data-test-id
      const yourGemsList = document.querySelector('[data-test-id="your-gems-list"]');
      
      if (yourGemsList) {
        // Lấy tất cả bot-list-row elements trong container này
        const botListRows = yourGemsList.querySelectorAll('bot-list-row');
        
        for (const row of botListRows) {
          // Tìm title span trong mỗi row - class là gds-title-m title
          const titleSpan = row.querySelector('span.gds-title-m.title, .gds-title-m.title, div.title-container span.gds-title-m.title');
          
          if (titleSpan) {
            const text = norm(titleSpan.textContent || titleSpan.innerText || '');
            if (text && 
                text.length > 0 && 
                text.length < 200 &&
                !result.includes(text)) {
              result.push(text);
            }
          }
        }
      }
      
      // Fallback: nếu không tìm thấy bằng data-test-id, tìm tất cả bot-list-row trong page
      if (result.length === 0) {
        const allBotListRows = document.querySelectorAll('bot-list-row');
        for (const row of allBotListRows) {
          // Tìm title span
          const titleSpan = row.querySelector('span.gds-title-m.title, .gds-title-m.title, div.title-container span');
          if (titleSpan) {
            const text = norm(titleSpan.textContent || titleSpan.innerText || '');
            // Filter out invalid names
            if (text && 
                text.length > 0 && 
                text.length < 200 &&
                text !== 'My Gems' &&
                text !== 'Pre-made by Google' &&
                text !== 'Your Gems' &&
                !text.toLowerCase().includes('show more') &&
                !text.toLowerCase().includes('new gem') &&
                !result.includes(text)) {
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
    return { status: 'failed', error: e?.message || String(e), gems: [] };
  } finally {
    try { browser.disconnect(); } catch (_) {}
  }
}

module.exports = { listGems };

