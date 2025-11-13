const { logger } = require('../logger');
const { connectToBrowserByUserDataDir } = require('./gmailLogin');
const { clickByText, clickSelectors, uploadKnowledgeFiles } = require('./gemini');

/**
 * Send a prompt to a specific Gem in Gemini
 * @param {Object} params
 * @param {string} params.userDataDir - Chrome user data directory
 * @param {number} [params.debugPort] - Optional DevTools port
 * @param {string} params.gem - Name of the Gem to select
 * @param {string[]} [params.listFile] - Array of file paths to upload
 * @param {string} params.prompt - Prompt text to send
 * @returns {Promise<{status: string, error?: string}>}
 */
async function sendPrompt({ userDataDir, debugPort, gem, listFile, prompt }) {
  const { browser } = await connectToBrowserByUserDataDir(userDataDir, debugPort);
  let status = 'unknown';
  try {
    const page = await browser.newPage();

    await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const host = (() => { try { return new URL(page.url()).hostname; } catch { return ''; } })();
    if (host.includes('accounts.google.com')) {
      status = 'not_logged_in';
      return { status };
    }

    // Wait for sidebar to load
    await new Promise((r) => setTimeout(r, 2000));

    // Step 1: Find and click the Gem by name in sidebar
    // Try to click the gem - prioritize button.bot-new-conversation-button inside bot-list-item
    const gemClicked = await page.evaluate((gemName) => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const targetName = norm(gemName);
      
      // First, try to find button.bot-new-conversation-button (the actual clickable element)
      const buttons = document.querySelectorAll('button.bot-new-conversation-button');
      
      for (const button of buttons) {
        const text = norm(button.textContent || button.innerText || '');
        
        // Try exact match first
        if (text === targetName) {
          try {
            button.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
            button.focus();
            button.click();
            return { clicked: true, method: 'exact_match_button', text, element: 'button' };
          } catch (e) {
            // Continue to next item
          }
        }
        
        // Try contains match (text includes targetName or targetName includes text)
        if (text.includes(targetName) || targetName.includes(text)) {
          try {
            button.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
            button.focus();
            button.click();
            return { clicked: true, method: 'contains_match_button', text, element: 'button' };
          } catch (e) {
            // Continue to next item
          }
        }
      }
      
      // Fallback: try bot-list-item itself
      const botListItems = document.querySelectorAll('bot-list-item');
      for (const item of botListItems) {
        const text = norm(item.textContent || item.innerText || '');
        
        // Try to find button inside this bot-list-item
        const innerButton = item.querySelector('button.bot-new-conversation-button');
        if (innerButton) {
          if (text === targetName || text.includes(targetName) || targetName.includes(text)) {
            try {
              innerButton.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
              innerButton.focus();
              innerButton.click();
              return { clicked: true, method: 'contains_match_inner_button', text, element: 'inner_button' };
            } catch (e) {
              // Continue
            }
          }
        }
        
        // Last resort: click the bot-list-item itself
        if (text === targetName || text.includes(targetName) || targetName.includes(text)) {
          try {
            item.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
            item.focus();
            item.click();
            return { clicked: true, method: 'contains_match_item', text, element: 'bot-list-item' };
          } catch (e) {
            // Continue
          }
        }
      }
      
      return { clicked: false };
    }, gem);
    
    // Wait a bit after clicking
    if (gemClicked && gemClicked.clicked) {
      await new Promise((r) => setTimeout(r, 300));
    }

    if (!gemClicked || !gemClicked.clicked) {
      // Fallback: try clicking by text using helper function
      const clicked = await clickByText(page, [gem], { timeoutMs: 5000 });
      if (!clicked) {
        status = 'gem_not_found';
        return { status, error: `Gem "${gem}" not found in sidebar` };
      }
    }

    // Wait for gem to load
    await new Promise((r) => setTimeout(r, 2000));
    
    // TODO: Temporarily commented out - uncomment after fixing gem click
    /*

    // Step 2: Upload files if provided
    // TODO: Temporarily commented out
    /*
    if (listFile && listFile.length > 0) {
      logger.info({ fileCount: listFile.length }, 'gemini: uploading files');
      
      const filesExist = listFile.filter((p) => {
        try {
          const fs = require('fs');
          return fs.existsSync(p);
        } catch (_) {
          return false;
        }
      });
      
      if (filesExist.length > 0) {
        const uploaded = await uploadKnowledgeFiles(page, filesExist);
        if (uploaded) {
          logger.info({}, 'gemini: files uploaded successfully');
          // Wait for upload to complete
          await new Promise((r) => setTimeout(r, 2000));
        } else {
          logger.warn({}, 'gemini: failed to upload files');
        }
      }
    }

    // Step 3: Find prompt textarea and enter prompt
    logger.info({ promptLength: prompt.length }, 'gemini: entering prompt');
    
    const promptEntered = await page.evaluate((promptText) => {
      // Try multiple selectors for the prompt input
      const selectors = [
        'textarea[aria-label*="prompt" i]',
        'textarea[aria-label*="query" i]',
        'textarea[placeholder*="prompt" i]',
        'textarea[placeholder*="Enter" i]',
        'textarea[placeholder*="Type" i]',
        'textarea.query-box-input',
        'textarea[formcontrolname="discoverSourcesQuery"]',
        'textarea',
      ];
      
      for (const sel of selectors) {
        const textarea = document.querySelector(sel);
        if (textarea) {
          try {
            textarea.focus();
            textarea.value = promptText;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          } catch (e) {
            // Continue to next selector
          }
        }
      }
      
      return false;
    }, prompt);

    if (!promptEntered) {
      // Fallback: try using Puppeteer's type method
      const textarea = await page.$('textarea[aria-label*="prompt" i], textarea[aria-label*="query" i], textarea[placeholder*="Enter" i], textarea.query-box-input, textarea');
      if (textarea) {
        await textarea.focus();
        await textarea.click({ clickCount: 3 });
        await textarea.type(prompt, { delay: 10 });
      } else {
        status = 'prompt_field_not_found';
        return { status, error: 'Prompt textarea not found' };
      }
    }

    // Step 4: Submit the prompt (click send button or press Enter)
    logger.info({}, 'gemini: submitting prompt');
    
    const submitted = await page.evaluate(() => {
      // Try to find send button
      const sendButtons = [
        'button[aria-label*="Send" i]',
        'button[aria-label*="Submit" i]',
        'button[type="submit"]',
        'button.send-button',
        'button[data-test-id*="send"]',
      ];
      
      for (const sel of sendButtons) {
        const btn = document.querySelector(sel);
        if (btn && !btn.disabled) {
          try {
            btn.click();
            return true;
          } catch (e) {
            // Continue
          }
        }
      }
      
      return false;
    });

    if (!submitted) {
      // Fallback: press Enter key
      await page.keyboard.press('Enter');
      await new Promise((r) => setTimeout(r, 500));
    }
    */

    status = 'gem_clicked';
    return { status };
  } catch (e) {
    logger.error({ err: e, stack: e?.stack }, 'gemini: error sending prompt');
    return { status: 'failed', error: e?.message || String(e) };
  } finally {
    try { browser.disconnect(); } catch (_) {}
  }
}

module.exports = { sendPrompt };

