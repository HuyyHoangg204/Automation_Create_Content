const { connectToBrowserByUserDataDir } = require('./gmailLogin');
const { clickByText, clickSelectors, uploadKnowledgeFiles } = require('./gemini');
const fs = require('fs');
const path = require('path');
const { logger } = require('../logger');
const logService = require('../services/logService');

async function typeIntoEditable(page, handle, text) {
  if (!handle) return false;
  try {
    await handle.focus();
    // Use execCommand for contenteditable; also dispatch input event
    await handle.evaluate((el, t) => {
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('insertText', false, t);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (e) {
        el.textContent = t;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, text);
    return true;
  } catch (_) { return false; }
}

async function extractTextFromGemini(page, browser, userDataDir) {
  try {
    const copyButtons = await page.$$('copy-button');
    
    if (!copyButtons || copyButtons.length === 0) {
      return { success: false, text: null, error: 'copy-button not found' };
    }
    
    const copyButton = copyButtons[copyButtons.length - 1];
    
    let clicked = false;
    try {
      let innerButton = await copyButton.$('button');
      if (!innerButton) {
        innerButton = await copyButton.$('[role="button"]');
      }
      if (!innerButton) {
        innerButton = copyButton;
      }
      
      if (innerButton) {
        await innerButton.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
        await new Promise((r) => setTimeout(r, 300));
        await innerButton.focus();
        await innerButton.click({ timeout: 2000 });
        await new Promise((r) => setTimeout(r, 1000));
        clicked = true;
      } else {
        await copyButton.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
        await new Promise((r) => setTimeout(r, 300));
        await copyButton.focus();
        await copyButton.click({ timeout: 2000 });
        await new Promise((r) => setTimeout(r, 1000));
        clicked = true;
      }
    } catch (clickErr) {
      clicked = await page.evaluate(() => {
        const copyButton = document.querySelector('copy-button');
        if (copyButton) {
          const innerButton = copyButton.querySelector('button') || 
                             copyButton.querySelector('[role="button"]') ||
                             copyButton;
          try {
            innerButton.scrollIntoView({ block: 'center', behavior: 'smooth' });
            innerButton.focus();
            innerButton.click();
            return true;
          } catch (e) {
            return false;
          }
        }
        return false;
      });
    }
    
    if (!clicked) {
      return { success: false, text: null, error: 'failed to click copy-button' };
    }
    
    const anotepadPage = await browser.newPage();
    
    await anotepadPage.goto('https://anotepad.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    await new Promise((r) => setTimeout(r, 2000));
    
    const editorFound = await anotepadPage.evaluate(() => {
      let editor = document.querySelector('#edit_textarea');
      if (!editor) {
        editor = document.querySelector('textarea[name="notecontent"]');
      }
      if (!editor) {
        editor = document.querySelector('textarea.form-control.textarea');
      }
      if (!editor) {
        editor = document.querySelector('textarea');
      }
      if (!editor) {
        editor = document.querySelector('[contenteditable="true"]');
      }
      if (!editor) {
        editor = document.querySelector('[role="textbox"]');
      }
      
      if (editor) {
        editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
        editor.focus();
        if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
          editor.value = '';
        } else {
          editor.textContent = '';
          editor.innerText = '';
        }
        return true;
      }
      return false;
    });
    
    if (!editorFound) {
      await anotepadPage.close();
      return { success: false, text: null, error: 'editor not found on anotepad.com' };
    }
    
    await new Promise((r) => setTimeout(r, 500));
    
    await anotepadPage.keyboard.down('Control');
    await anotepadPage.keyboard.press('a');
    await anotepadPage.keyboard.up('Control');
    await new Promise((r) => setTimeout(r, 200));
    
    await anotepadPage.keyboard.down('Control');
    await anotepadPage.keyboard.press('v');
    await anotepadPage.keyboard.up('Control');
    
    await new Promise((r) => setTimeout(r, 2000));
    
    const text = await anotepadPage.evaluate(() => {
      let editor = document.querySelector('#edit_textarea');
      if (!editor) {
        editor = document.querySelector('textarea[name="notecontent"]');
      }
      if (!editor) {
        editor = document.querySelector('textarea.form-control.textarea');
      }
      if (!editor) {
        editor = document.querySelector('textarea');
      }
      
      if (editor) {
        if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
          return editor.value || '';
        } else {
          return editor.textContent || editor.innerText || '';
        }
      }
      return '';
    });
    
    await anotepadPage.close();
    
    if (!text || text.trim().length === 0) {
      return { success: false, text: null, error: 'no text extracted from anotepad.com' };
    }
    
    return { success: true, text, error: null };
  } catch (err) {
    return { success: false, text: null, error: err.message };
  }
}

/**
 * Upload files to chat input area via file chooser
 * This function clicks a button to trigger file chooser, then accepts files
 * @param {Page} page - Puppeteer page object
 * @param {string[]} files - Array of file paths
 * @returns {Promise<boolean>} - True if upload succeeded
 */
async function uploadFilesViaFileChooser(page, files) {
  if (!files || !files.length) return false;
  
  const existing = files.filter((p) => {
    try { return fs.existsSync(p); } catch (_) { return false; }
  });
  if (!existing.length) return false;

  try {
    // Step 1: Patch HTMLInputElement.prototype.click to prevent OS dialog
    await page.evaluate(() => {
      // Store original click method
      const originalClick = HTMLInputElement.prototype.click;
      
      // Patch click method
      HTMLInputElement.prototype.click = function() {
        // If this is a file input, don't call native click (prevent OS dialog)
        if (this.type === 'file') {
          // Just return without calling native click
          // This allows Gemini to create input but prevents OS dialog
          return;
        }
        // For other input types, call original click
        return originalClick.call(this);
      };
      
      // Store reference so we can restore later if needed
      window.__puppeteer_patched_input_click = originalClick;
    });
    
    // Step 2: Scroll to input area first to ensure button is visible
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await new Promise((r) => setTimeout(r, 1000));
    
    // Step 3: Wait for button to appear and click it
    // Use waitForFunction to wait for button to be visible
    const buttonFound = await page.waitForFunction(() => {
      // Try multiple selectors including Vietnamese
      const selectors = [
        // Vietnamese - exact match
        'button[aria-label="Mở trình đơn tải tệp lên"]',
        'button[aria-label*="Mở trình đơn tải tệp"]',
        'button[aria-label*="mở trình đơn"]',
        // English
        'button[aria-label="Open upload file menu"]',
        'button[aria-label*="upload" i]',
        'button[aria-label*="file" i]',
        // By class
        'button.upload-card-button',
        'button[class*="upload-card-button"]',
      ];
      
      for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn && btn.offsetParent !== null) {
          return btn;
        }
      }
      
      // Fallback: search all buttons for upload-related text or icon
      const allButtons = Array.from(document.querySelectorAll('button'));
      for (const btn of allButtons) {
        if (btn.offsetParent === null) continue;
        
        const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
        const classes = (btn.className || '').toLowerCase();
        const hasAddIcon = !!btn.querySelector('mat-icon[data-mat-icon-name="add_2"]');
        const hasUploadClass = classes.includes('upload-card-button') || classes.includes('upload');
        
        if ((ariaLabel.includes('mở trình đơn tải tệp') || 
             ariaLabel.includes('open upload file menu') ||
             ariaLabel.includes('upload') ||
             ariaLabel.includes('file') ||
             (hasAddIcon && hasUploadClass))) {
          return btn;
        }
      }
      
      return null;
    }, { timeout: 10000 }).catch(() => null);
    
    if (!buttonFound) {
      return false;
    }
    
    // Click the button
    await buttonFound.asElement().evaluate((btn) => {
      btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      btn.focus();
    });
    await new Promise((r) => setTimeout(r, 300));
    await buttonFound.asElement().click();
    
    // Wait for menu to appear
    await new Promise((r) => setTimeout(r, 800));
    
    // Click "Upload files" menu item (support both English and Vietnamese)
    const menuItemClicked = await page.evaluate(() => {
      const menuItems = [
        // By data-test-id (most reliable)
        'button[data-test-id="local-images-files-uploader-button"]',
        // Vietnamese - exact match
        'button[aria-label="Tải tệp lên. Tài liệu, dữ liệu, tệp mã nguồn"]',
        'button[aria-label*="Tải tệp lên"]',
        'button[aria-label*="tải tệp"]',
        // English
        'button[aria-label="Upload files"]',
        'button[aria-label*="Upload" i]',
      ];
      
      for (const sel of menuItems) {
        const item = document.querySelector(sel);
        if (item && item.offsetParent !== null) {
          item.scrollIntoView({ behavior: 'smooth', block: 'center' });
          item.focus();
          item.click();
          return true;
        }
      }
      
      // Fallback: search all elements in menu for upload text
      const allElements = Array.from(document.querySelectorAll('button, div[role="menuitem"], div[role="button"]'));
      for (const el of allElements) {
        if (el.offsetParent === null) continue;
        
        const text = (el.textContent || el.innerText || '').toLowerCase();
        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
        const dataTestId = el.getAttribute('data-test-id') || '';
        
        if (dataTestId === 'local-images-files-uploader-button' ||
            text.includes('tải tệp lên') ||
            text.includes('upload files') ||
            ariaLabel.includes('tải tệp lên') ||
            ariaLabel.includes('upload files')) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.focus();
          el.click();
          return true;
        }
      }
      
      return false;
    });
    
    // Wait for input to be created (Gemini will try to click it, but our patch prevents OS dialog)
    await new Promise((r) => setTimeout(r, 500));
    
    // Step 3: Find the input that Gemini created (should be in DOM now, no OS dialog opened)
    const fileInputSelectors = [
      '#cdk-overlay-1 > mat-card > mat-action-list > images-files-uploader > input[type=file]',
      'input[type="file"][name="Filedata"]',
      'images-files-uploader input[type="file"]',
      'input[type="file"][multiple]',
      'input[type="file"]'
    ];
    
    let fileInput = null;
    let foundSelector = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      for (const selector of fileInputSelectors) {
        try {
          fileInput = await page.$(selector);
          if (fileInput) {
            foundSelector = selector;
            break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      if (fileInput) break;
      
      // If not found, wait a bit and try again
      if (!fileInput) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    
    if (fileInput) {
      // Step 4: Use Puppeteer uploadFile() to upload files (no OS dialog because click is patched)
      try {
        await fileInput.uploadFile(...existing);
        
        // Step 5: Trigger change event to notify Gemini handlers
        await page.evaluate((sel) => {
          const input = document.querySelector(sel);
          if (input) {
            input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, foundSelector);
        
        // Step 6: Restore original click method (optional, but good practice)
        await page.evaluate(() => {
          if (window.__puppeteer_patched_input_click) {
            HTMLInputElement.prototype.click = window.__puppeteer_patched_input_click;
            delete window.__puppeteer_patched_input_click;
          }
        });
        
        // Wait for upload to process
        await new Promise((r) => setTimeout(r, 2000));
        return true;
      } catch (uploadError) {
        // Restore original click method even on error
        await page.evaluate(() => {
          if (window.__puppeteer_patched_input_click) {
            HTMLInputElement.prototype.click = window.__puppeteer_patched_input_click;
            delete window.__puppeteer_patched_input_click;
          }
        });
      }
    } else {
      // Restore original click method
      await page.evaluate(() => {
        if (window.__puppeteer_patched_input_click) {
          HTMLInputElement.prototype.click = window.__puppeteer_patched_input_click;
          delete window.__puppeteer_patched_input_click;
        }
      });
    }
    
    return false;
  } catch (e) {
    return false;
  }
}

/**
 * Send a prompt to a specific Gem in Gemini
 * @param {Object} params
 * @param {string} params.userDataDir - Chrome user data directory
 * @param {number} [params.debugPort] - Optional DevTools port
 * @param {string} params.gem - Name of the Gem to select
 * @param {string[]} [params.listFile] - Array of file paths to upload
 * @param {string} params.prompt - Prompt text to send
 * @param {Function} [params.onProgress] - Callback for progress updates: (stage, message, metadata) => void
 * @param {string} [params.entityType] - Entity type for logging (default: 'topic')
 * @param {string} [params.entityID] - Entity ID for logging (default: 'unknown')
 * @param {string} [params.userID] - User ID for logging (default: 'unknown')
 * @returns {Promise<{status: string, error?: string}>}
 */
async function sendPrompt({ userDataDir, debugPort, gem, listFile, prompt, onProgress, entityType = 'topic', entityID = 'unknown', userID = 'unknown' }) {
  logger.info({ entityType, entityID, userID, userDataDir, debugPort, gem, prompt_preview: prompt?.substring(0, 100) }, '[SendPrompt] Bắt đầu hàm sendPrompt');
  
  const { browser } = await connectToBrowserByUserDataDir(userDataDir, debugPort);
  let status = 'unknown';
  let copiedText = null;
  let page = null;
  try {
    await logService.logInfo(entityType, entityID, userID, 'prompt_sending_step', 
      'Đang kết nối đến Chrome và mở trang Gemini', {
        gem_name: gem,
        prompt_preview: prompt ? prompt.substring(0, 100) : 'unknown'
      });

    // Option 1: Each project starts with fresh gem - close existing Gemini tabs and create new one
    // This ensures each project works with the correct gem specified in gemName
    const pages = await browser.pages();
    for (const existingPage of pages) {
      if (!existingPage.isClosed()) {
        try {
          const pageUrl = existingPage.url();
          if (pageUrl.includes('gemini.google.com')) {
            await existingPage.close();
          }
        } catch (e) {
        }
      }
    }

    // Always create a new page for new project (Option 1: fresh start for each project)
    page = await browser.newPage();
    await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 30000 });

    const host = (() => { try { return new URL(page.url()).hostname; } catch { return ''; } })();
    if (host.includes('accounts.google.com')) {
      status = 'not_logged_in';
      await logService.logWarning(entityType, entityID, userID, 'prompt_sending_step', 
        'Chưa đăng nhập vào Google', {});
      return { status };
    }

    // Wait for sidebar to load
    await new Promise((r) => setTimeout(r, 2000));

    // Step 1: Click "Explore Gems" or "Bot List" button in sidebar
    await logService.logInfo(entityType, entityID, userID, 'prompt_sending_step', 
      'Đang navigate đến Explore Gems / Bot List', {
        gem_name: gem
      });
    
     // Try new UI selector first: bot-list-side-nav-entry-button
    let clickedExplore = false;
    try {
      const botListButton = await page.waitForSelector(
        '[data-test-id="bot-list-side-nav-entry-button"]',
        { timeout: 5000 }
      ).catch(() => null);

      if (botListButton) {
         // Check visibility
        const isHidden = await botListButton.evaluate((el) => {
          const style = window.getComputedStyle(el);
          return style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0' || el.offsetParent === null;
        });

        if (isHidden) {
           const menuButton = await page.$('button[data-test-id="side-nav-menu-button"]');
           if (menuButton) {
             await menuButton.click();
             await new Promise(r => setTimeout(r, 500));
           }
        }

        await botListButton.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        await new Promise(r => setTimeout(r, 300));
        await botListButton.click();
        clickedExplore = true;
      }
    } catch (e) {
      logger.warn({ error: e.message }, '[Gemini] Failed to click bot list button');
    }

    if (!clickedExplore) {
      clickedExplore = await clickSelectors(page, [
        'button[aria-label="Explore Gems"]',
        'button[aria-label*="Explore Gems" i]',
        '[aria-label="Explore Gems"]',
      ], { timeoutMs: 5000 });
    }
    
    if (!clickedExplore) {
      clickedExplore = await clickByText(page, ['Explore Gems', 'Khám phá Gems'], { timeoutMs: 5000 });
    }
    
    if (clickedExplore) {
       await logService.logInfo(entityType, entityID, userID, 'prompt_sending_step', 
         'Đã navigate đến Explore Gems / Bot List thành công', {
           gem_name: gem
         });
    } else {
       await logService.logWarning(entityType, entityID, userID, 'prompt_sending_step', 
         'Không thể navigate đến Explore Gems / Bot List', {
           gem_name: gem
         });
    }
    
    // Wait for Explore Gems page to load
    await Promise.race([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {}),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
    
    // Wait a bit for bot-list-row elements to appear
    await new Promise((r) => setTimeout(r, 1000));

    // Step 2: Scroll down to load more gems (lazy loading)
    await page.evaluate(async () => {
      const containers = [
        document.querySelector('div.bot-list-container'),
        document.querySelector('div[class*="bot-list"]'),
        document.querySelector('div.content-container'),
        document.querySelector('bard-sidenav-content'),
        document.querySelector('div[class*="scroll"]'),
        document.querySelector('div[class*="list"]'),
        document.querySelector('main'),
        document.querySelector('div[role="main"]'),
        document.body,
      ];
      
      let scrollContainer = null;
      for (const container of containers) {
        if (container && container.scrollHeight > container.clientHeight) {
          scrollContainer = container;
          break;
        }
      }
      
      if (!scrollContainer) {
        scrollContainer = document.body;
      }
      
      const initialScrollTop = scrollContainer.scrollTop;
      const initialBotListRowsCount = document.querySelectorAll('bot-list-row').length;
      
      let lastScrollTop = initialScrollTop;
      let lastBotListRowsCount = initialBotListRowsCount;
      let scrollAttempts = 0;
      const maxScrollAttempts = 10;
      
      while (scrollAttempts < maxScrollAttempts) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
        await new Promise((r) => setTimeout(r, 500));
        
        const afterScrollTop = scrollContainer.scrollTop;
        const afterCount = document.querySelectorAll('bot-list-row').length;
        
        if (afterScrollTop === lastScrollTop && afterCount === lastBotListRowsCount) {
          break;
        }
        
        lastScrollTop = afterScrollTop;
        lastBotListRowsCount = afterCount;
        scrollAttempts++;
      }
    });
    
    await new Promise((r) => setTimeout(r, 500));

    // Step 3: Find and click the Gem by name in bot-list-row elements
    const gemClicked = await page.evaluate((gemName) => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const targetName = norm(gemName);
      
      const extractGemName = (text) => {
        const cleaned = text.replace(/^[a-zA-Z]\s+/, '').trim();
        return cleaned;
      };
      
      const matchesTarget = (text, target) => {
        const gemName = extractGemName(text);
        if (gemName === target || text === target) {
          return { match: true, type: 'exact' };
        }
        
        const targetIndex = text.indexOf(target);
        if (targetIndex !== -1) {
          const afterTarget = text.substring(targetIndex + target.length);
          if (afterTarget === '' || !/^[a-zA-Z0-9]/.test(afterTarget)) {
            return { match: true, type: 'contains' };
          }
        }
        
        const gemNameIndex = gemName.indexOf(target);
        if (gemNameIndex !== -1) {
          const afterTarget = gemName.substring(gemNameIndex + target.length);
          if (afterTarget === '' || !/^[a-zA-Z0-9]/.test(afterTarget)) {
            return { match: true, type: 'contains-extracted' };
          }
        }
        
        return { match: false };
      };
      
      const botListRows = Array.from(document.querySelectorAll('bot-list-row'));
      
      // First pass: Try exact match
      for (const row of botListRows) {
        const text = norm(row.textContent || row.innerText || '');
        const matchResult = matchesTarget(text, targetName);
        
        if (matchResult.match && matchResult.type === 'exact') {
          try {
            const clickableButton = row.querySelector('button.bot-new-conversation-button');
            if (clickableButton) {
              clickableButton.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
              clickableButton.focus();
              clickableButton.click();
              return { clicked: true, method: 'bot-list-row-button-exact' };
            }
            
            const link = row.querySelector('a');
            if (link) {
              link.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
              link.focus();
              link.click();
              return { clicked: true, method: 'bot-list-row-link-exact' };
            }
            
            row.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
            row.focus();
            row.click();
            return { clicked: true, method: 'bot-list-row-direct-exact' };
          } catch (e) {
            return { clicked: false, error: e.message };
          }
        }
      }
      
      // Second pass: Try contains match
      for (const row of botListRows) {
        const text = norm(row.textContent || row.innerText || '');
        const matchResult = matchesTarget(text, targetName);
        
        if (matchResult.match && matchResult.type !== 'exact') {
          try {
            const clickableButton = row.querySelector('button.bot-new-conversation-button');
            if (clickableButton) {
              clickableButton.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
              clickableButton.focus();
              clickableButton.click();
              return { clicked: true, method: `bot-list-row-button-${matchResult.type}` };
            }
            
            const link = row.querySelector('a');
            if (link) {
              link.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
              link.focus();
              link.click();
              return { clicked: true, method: `bot-list-row-link-${matchResult.type}` };
            }
            
            row.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
            row.focus();
            row.click();
            return { clicked: true, method: `bot-list-row-direct-${matchResult.type}` };
          } catch (e) {
            // Continue to next row
          }
        }
      }
      
      // Fallback: try bot-list-item in sidebar
      const botListItems = Array.from(document.querySelectorAll('bot-list-item'));
      
      for (const item of botListItems) {
        const text = norm(item.textContent || item.innerText || '');
        const matchResult = matchesTarget(text, targetName);
        
        if (matchResult.match) {
          const innerButton = item.querySelector('button.bot-new-conversation-button');
          if (innerButton) {
            try {
              innerButton.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
              innerButton.focus();
              innerButton.click();
              return { clicked: true, method: `sidebar-bot-list-item-${matchResult.type}` };
            } catch (e) {
              // Continue
            }
          }
        }
      }
      
      return { clicked: false };
    }, gem);
    
    // Wait a bit after clicking
    if (gemClicked && gemClicked.clicked) {
      await logService.logInfo(entityType, entityID, userID, 'prompt_sending_step', 
        'Đã click vào gem thành công', {
          gem_name: gem,
          method: gemClicked.method
        });
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!gemClicked || !gemClicked.clicked) {
      // Fallback 1: Scroll more and try again
      await page.evaluate(async () => {
        const containers = [
          document.querySelector('div.bot-list-container'),
          document.querySelector('div[class*="bot-list"]'),
          document.querySelector('div.content-container'),
          document.querySelector('bard-sidenav-content'),
          document.querySelector('div[class*="scroll"]'),
          document.querySelector('div[class*="list"]'),
          document.querySelector('main'),
          document.querySelector('div[role="main"]'),
          document.body,
        ];
        
        let scrollContainer = null;
        for (const container of containers) {
          if (container && container.scrollHeight > container.clientHeight) {
            scrollContainer = container;
            break;
          }
        }
        
        if (!scrollContainer) {
          scrollContainer = document.body;
        }
        
        for (let i = 0; i < 5; i++) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
          await new Promise((r) => setTimeout(r, 300));
        }
      });
      
      await new Promise((r) => setTimeout(r, 500));
      
      // Retry finding gem
      const gemClickedRetry = await page.evaluate((gemName) => {
        const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
        const targetName = norm(gemName);
        
        const extractGemName = (text) => {
          const cleaned = text.replace(/^[a-zA-Z]\s+/, '').trim();
          return cleaned;
        };
        
        const matchesTarget = (text, target) => {
          const gemName = extractGemName(text);
          if (gemName === target || text === target) {
            return { match: true, type: 'exact' };
          }
          
          const targetIndex = text.indexOf(target);
          if (targetIndex !== -1) {
            const afterTarget = text.substring(targetIndex + target.length);
            if (afterTarget === '' || !/^[a-zA-Z0-9]/.test(afterTarget)) {
              return { match: true, type: 'contains' };
            }
          }
          
          const gemNameIndex = gemName.indexOf(target);
          if (gemNameIndex !== -1) {
            const afterTarget = gemName.substring(gemNameIndex + target.length);
            if (afterTarget === '' || !/^[a-zA-Z0-9]/.test(afterTarget)) {
              return { match: true, type: 'contains-extracted' };
            }
          }
          
          return { match: false };
        };
        
        const botListRows = Array.from(document.querySelectorAll('bot-list-row'));
        
        // First pass: exact match
        for (const row of botListRows) {
          const text = norm(row.textContent || row.innerText || '');
          const matchResult = matchesTarget(text, targetName);
          
          if (matchResult.match && matchResult.type === 'exact') {
            try {
              const clickableButton = row.querySelector('button.bot-new-conversation-button');
              if (clickableButton) {
                clickableButton.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
                clickableButton.focus();
                clickableButton.click();
                return { clicked: true, method: 'bot-list-row-button-exact-retry' };
              }
              
              const link = row.querySelector('a');
              if (link) {
                link.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
                link.focus();
                link.click();
                return { clicked: true, method: 'bot-list-row-link-exact-retry' };
              }
              
              row.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
              row.focus();
              row.click();
              return { clicked: true, method: 'bot-list-row-direct-exact-retry' };
            } catch (e) {
              return { clicked: false, error: e.message };
            }
          }
        }
        
        // Second pass: contains match
        for (const row of botListRows) {
          const text = norm(row.textContent || row.innerText || '');
          const matchResult = matchesTarget(text, targetName);
          
          if (matchResult.match && matchResult.type !== 'exact') {
            try {
              const clickableButton = row.querySelector('button.bot-new-conversation-button');
              if (clickableButton) {
                clickableButton.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
                clickableButton.focus();
                clickableButton.click();
                return { clicked: true, method: `bot-list-row-button-${matchResult.type}-retry` };
              }
              
              const link = row.querySelector('a');
              if (link) {
                link.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
                link.focus();
                link.click();
                return { clicked: true, method: `bot-list-row-link-${matchResult.type}-retry` };
              }
              
              row.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
              row.focus();
              row.click();
              return { clicked: true, method: `bot-list-row-direct-${matchResult.type}-retry` };
            } catch (e) {
              // Continue
            }
          }
        }
        
        return { clicked: false };
      }, gem);
      
      if (gemClickedRetry && gemClickedRetry.clicked) {
        await new Promise((r) => setTimeout(r, 500));
      } else {
        // Fallback 2: try clicking by text using helper function
        const clicked = await clickByText(page, [gem], { timeoutMs: 5000 });
        if (!clicked) {
          status = 'gem_not_found';
          await logService.logError(entityType, entityID, userID, 'prompt_sending_step', 
            `Không tìm thấy gem: ${gem}`, {
              gem_name: gem
            });
          return { status, error: `Gem "${gem}" not found in bot-list-row or sidebar` };
        }
      }
    }

    // Wait for gem to load
    await new Promise((r) => setTimeout(r, 2000));
    
    // Scroll to bottom to ensure input area is visible
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await new Promise((r) => setTimeout(r, 1000));
    
    // Step 2: Upload files if provided (using direct file assignment method)
    if (listFile && listFile.length > 0) {
      const filesExist = listFile.filter((p) => {
        try {
          return fs.existsSync(p);
        } catch (_) {
          return false;
        }
      });
      
      if (filesExist.length > 0) {
        await logService.logInfo(entityType, entityID, userID, 'prompt_sending_step', 
          'Đang upload file lên Gemini', {
            gem_name: gem,
            file_count: filesExist.length
          });
        
        if (onProgress) {
          onProgress('file_uploading', 'Đang upload file lên Gemini', { file_count: filesExist.length });
        }
        
        try {
          // Scroll to bottom to ensure input area is visible
          await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
          });
          await new Promise((r) => setTimeout(r, 500));
          
          // Upload files via file chooser (click button to trigger file chooser)
          const uploaded = await uploadFilesViaFileChooser(page, filesExist);
          if (uploaded) {
            await logService.logSuccess(entityType, entityID, userID, 'prompt_sending_step', 
              'Đã upload file thành công', {
                gem_name: gem,
                file_count: filesExist.length
              });
            if (onProgress) {
              onProgress('file_uploaded', 'Đã upload file thành công', { file_count: filesExist.length });
            }
            await new Promise((r) => setTimeout(r, 2000));
          } else {
            // Fallback: try uploadKnowledgeFiles (for Knowledge section)
            const uploaded2 = await uploadKnowledgeFiles(page, filesExist);
            if (uploaded2) {
              await logService.logSuccess(entityType, entityID, userID, 'prompt_sending_step', 
                'Đã upload file thành công (fallback method)', {
                  gem_name: gem,
                  file_count: filesExist.length
                });
              if (onProgress) {
                onProgress('file_uploaded', 'Đã upload file thành công', { file_count: filesExist.length });
              }
              await new Promise((r) => setTimeout(r, 2000));
            } else {
              await logService.logWarning(entityType, entityID, userID, 'prompt_sending_step', 
                'Không thể upload file', {
                  gem_name: gem,
                  file_count: filesExist.length
                });
            }
          }
        } catch (e) {
          // Fallback to uploadKnowledgeFiles
          try {
            const uploaded = await uploadKnowledgeFiles(page, filesExist);
            if (uploaded) {
              if (onProgress) {
                onProgress('file_uploaded', 'Đã upload file thành công', { file_count: filesExist.length });
              }
              await new Promise((r) => setTimeout(r, 2000));
            }
          } catch (e2) {
            // Ignore
          }
        }
      }
    }

    // Step 3: Find prompt textarea/rich-textarea and enter prompt
    if (prompt) {
      await logService.logInfo(entityType, entityID, userID, 'prompt_sending_step', 
        'Đang tìm và nhập prompt vào textarea', {
          gem_name: gem,
          prompt_preview: prompt.substring(0, 100)
        });
      
      let promptField = null;
      let promptEntered = false;
      
      // Try 1: Wait for rich-textarea element to appear (Angular component)
      try {
        const richTextarea = await page.waitForSelector('rich-textarea', { timeout: 10000 }).catch(() => null);
        if (richTextarea) {
          // Find the contenteditable div inside rich-textarea (usually .ql-editor)
          promptField = await richTextarea.$('.ql-editor, [contenteditable="true"], div[role="textbox"]');
          if (promptField) {
            const entered = await typeIntoEditable(page, promptField, prompt);
            if (entered) {
              promptEntered = true;
              await logService.logInfo(entityType, entityID, userID, 'prompt_sending_step', 
                'Đã nhập prompt vào textarea thành công', {
                  gem_name: gem,
                  prompt_preview: prompt.substring(0, 100)
                });
            } else {
              promptField = null;
            }
          }
        }
      } catch (e) {
        // Try fallback
      }
      
      // Try 2: Fallback - tìm trực tiếp các selectors khác
      if (!promptEntered) {
        const fallbackSelectors = [
          'rich-textarea .ql-editor',
          'rich-textarea [contenteditable="true"]',
          'rich-textarea div[role="textbox"]',
          '[contenteditable="true"][role="textbox"]',
          '.ql-editor[contenteditable="true"]',
          'textarea[aria-label*="Nhập câu lệnh" i]',
          'textarea[aria-label*="Enter command" i]',
          'textarea[placeholder*="Nhập câu lệnh" i]',
          'textarea[placeholder*="Enter command" i]',
        ];
        
        for (const selector of fallbackSelectors) {
          try {
            promptField = await page.$(selector);
            if (promptField) {
              const entered = await typeIntoEditable(page, promptField, prompt);
              if (entered) {
                promptEntered = true;
                break;
              }
            }
          } catch (e) {
            // Continue to next selector
          }
        }
      }
      
      if (!promptEntered) {
        status = 'prompt_not_entered';
        await logService.logError(entityType, entityID, userID, 'prompt_sending_step', 
          'Không thể tìm hoặc nhập prompt vào input field', {
            gem_name: gem
          });
        return { status, error: 'Could not find or enter prompt into input field' };
      }

      // Step 4: Set up CDP to intercept StreamGenerate request before submitting
      await logService.logInfo(entityType, entityID, userID, 'prompt_sending_step', 
        'Đang setup CDP để track StreamGenerate request', {
          gem_name: gem
        });
      let responseFinishedPromise = null;
      let cdpSession = null;
      let streamGenerateDetected = false;
      
      responseFinishedPromise = new Promise((resolve, reject) => {
        const client = page._client();
        cdpSession = client;
        
        // Enable Network domain
        client.send('Network.enable').catch(() => {});
        
        let targetRequestId = null;
        const timeout = setTimeout(() => {
          if (!streamGenerateDetected) {
            reject(new Error('Timeout waiting for StreamGenerate request'));
          } else {
            resolve(true);
          }
        }, 60000);
        
        // Track the StreamGenerate request
        client.on('Network.responseReceived', (event) => {
          const { response } = event;
          if (response.url.includes('StreamGenerate') && response.status === 200) {
            targetRequestId = event.requestId;
            streamGenerateDetected = true;
            clearTimeout(timeout);
            if (onProgress) {
              onProgress('gemini_generating', 'Đã gửi prompt, đang chờ Gemini tạo kịch bản', {});
            }
          }
        });
        
        // Wait for loading finished (indicates response is complete)
        client.on('Network.loadingFinished', (event) => {
          if (event.requestId === targetRequestId && targetRequestId) {
            clearTimeout(timeout);
            resolve(true);
          }
        });
      });
      
      // Step 5: Submit the prompt (click send button or press Enter)
      await logService.logInfo(entityType, entityID, userID, 'prompt_sending_step', 
        'Đang submit prompt', {
          gem_name: gem
        });
      
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

      if (submitted) {
        await logService.logInfo(entityType, entityID, userID, 'prompt_sending_step', 
          'Đã submit prompt bằng button', {
            gem_name: gem
          });
        await new Promise((r) => setTimeout(r, 500));
      } else {
        // Fallback: press Enter key
        await logService.logInfo(entityType, entityID, userID, 'prompt_sending_step', 
          'Không tìm thấy send button, đang nhấn Enter', {
            gem_name: gem
          });
        await page.keyboard.press('Enter');
        await new Promise((r) => setTimeout(r, 500));
        await logService.logInfo(entityType, entityID, userID, 'prompt_sending_step', 
          'Đã nhấn Enter để submit prompt', {
            gem_name: gem
          });
      }

      // Step 6: Wait for StreamGenerate response to finish, then extract text
      if (responseFinishedPromise) {
        try {
          await logService.logInfo(entityType, entityID, userID, 'prompt_sending_step', 
            'Bắt đầu đợi response từ Gemini', {
              gem_name: gem
            });
          
          // Wait for Network.loadingFinished event (indicates response is complete)
          await responseFinishedPromise;
          
          await logService.logInfo(entityType, entityID, userID, 'prompt_sending_step', 
            'Đã nhận response từ Gemini, đang extract text', {
              gem_name: gem
            });
          
          // Wait a bit more for response to fully render in DOM
          await new Promise((r) => setTimeout(r, 2000));
          
          // Scroll xuống cuối để đảm bảo response đã render
          await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
          });
          await new Promise((r) => setTimeout(r, 500));
          
          // Chờ 2 giây trước khi copy để đảm bảo response đã render đầy đủ
          await new Promise((r) => setTimeout(r, 2000));
          
          // Extract text from Gemini (sẽ tìm copy-button cuối cùng)
          const extractResult = await extractTextFromGemini(page, browser, userDataDir);
          
          if (extractResult.success && extractResult.text) {
            copiedText = extractResult.text;
            await logService.logSuccess(entityType, entityID, userID, 'prompt_sending_step', 
              'Đã extract text thành công từ Gemini', {
                gem_name: gem,
                text_length: copiedText.length
              });
            
            if (onProgress) {
              onProgress('gemini_completed', 'Gemini đã tạo kịch bản xong', {});
            }
            
            if (onProgress) {
              onProgress('text_copied', 'Đã copy text từ Gemini', {
                text: copiedText,
                text_length: copiedText.length
              });
            }
          } else {
            await logService.logWarning(entityType, entityID, userID, 'prompt_sending_step', 
              'Không thể extract text từ Gemini', {
                gem_name: gem,
                error: extractResult.error || 'Unknown error'
              });
          }
          
          // Clean up CDP
          if (cdpSession) {
            try {
              await cdpSession.send('Network.disable').catch(() => {});
            } catch (e) {
              // Ignore cleanup errors
            }
          }
        } catch (e) {
          logger.error({ error: e.message, stack: e.stack }, '[SendNextPrompt] Lỗi khi đợi response hoặc extract text');
          await logService.logError(entityType, entityID, userID, 'prompt_sending_step', 
            `Lỗi khi đợi response hoặc extract text: ${e?.message || String(e)}`, {
              gem_name: gem,
              error: e?.message || String(e)
            });
          
          // Clean up on error
          if (cdpSession) {
            try {
              await cdpSession.send('Network.disable').catch(() => {});
            } catch (cleanupErr) {
              // Ignore cleanup errors
            }
          }
        }
      }
    }

    status = 'success';
    await logService.logSuccess(entityType, entityID, userID, 'prompt_sending_step', 
      'Hoàn thành gửi prompt', {
        gem_name: gem,
        has_response: !!copiedText,
        text_length: copiedText?.length || 0
      });
    
    return { status, copiedText: copiedText || null };
  } catch (e) {
    await logService.logError(entityType, entityID, userID, 'prompt_sending_step', 
      `Lỗi khi gửi prompt: ${e?.message || String(e)}`, {
        gem_name: gem,
        error: e?.message || String(e)
      });
    
    return { status: 'failed', error: e?.message || String(e) };
  } finally {
    // KHÔNG disconnect browser để sendNextPrompt có thể reuse page Gemini
    // Browser sẽ được disconnect khi project kết thúc hoặc khi exit
  }
}

/**
 * Send next prompt in the same conversation (without clicking gem again)
 * @param {Object} params
 * @param {string} params.userDataDir - Chrome user data directory
 * @param {number} [params.debugPort] - Optional DevTools port
 * @param {string} params.prompt - Prompt text to send
 * @param {Function} [params.onProgress] - Callback for progress updates: (stage, message, metadata) => void
 * @param {string} [params.entityType] - Entity type for logging (default: 'topic')
 * @param {string} [params.entityID] - Entity ID for logging (default: 'unknown')
 * @param {string} [params.userID] - User ID for logging (default: 'unknown')
 * @returns {Promise<{status: string, copiedText?: string, error?: string}>}
 */
async function sendNextPrompt({ userDataDir, debugPort, prompt, onProgress, entityType = 'topic', entityID = 'unknown', userID = 'unknown' }) {
  logger.info({ userDataDir, debugPort, prompt_preview: prompt?.substring(0, 50) }, '[SendNextPrompt] Bắt đầu');
  
  const { browser } = await connectToBrowserByUserDataDir(userDataDir, debugPort);
  
  let status = 'unknown';
  let copiedText = null;
  let page = null;
  try {
    const pages = await browser.pages();
    
    for (const existingPage of pages) {
      if (!existingPage.isClosed()) {
        try {
          const pageUrl = existingPage.url();
          if (pageUrl.includes('gemini.google.com')) {
            page = existingPage;
            break;
          }
        } catch (e) {
        }
      }
    }
    
    if (!page || page.isClosed()) {
      page = await browser.newPage();
      await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 30000 });
      const host = (() => { try { return new URL(page.url()).hostname; } catch { return ''; } })();
      
      if (host.includes('accounts.google.com')) {
        status = 'not_logged_in';
        await logService.logWarning(entityType, entityID, userID, 'prompt_sending_step', 
          'Chưa đăng nhập vào Google', {});
        return { status };
      }
    } else {
      const currentUrl = page.url();
      
      if (!currentUrl.includes('gemini.google.com')) {
        await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        const host = (() => { try { return new URL(page.url()).hostname; } catch { return ''; } })();
        if (host.includes('accounts.google.com')) {
          status = 'not_logged_in';
          await logService.logWarning(entityType, entityID, userID, 'prompt_sending_step', 
            'Chưa đăng nhập vào Google', {});
          return { status };
        }
      }
      
      try {
        await page.waitForSelector('rich-textarea', { timeout: 5000 }).catch(() => {});
      } catch (e) {
      }
    }

    await new Promise((r) => setTimeout(r, 2000));

    if (prompt) {
      let promptField = null;
      let promptEntered = false;
      
      try {
        const richTextarea = await page.waitForSelector('rich-textarea', { timeout: 10000 });
        
        if (richTextarea) {
          await page.waitForSelector('rich-textarea .ql-editor, rich-textarea [contenteditable="true"], rich-textarea div[role="textbox"]', { timeout: 5000 }).catch(() => {});
          await new Promise((r) => setTimeout(r, 500));
          
          promptField = await richTextarea.$('.ql-editor, [contenteditable="true"], div[role="textbox"]');
          
          if (promptField) {
            await promptField.evaluateHandle((el) => {
              if (el && typeof el.focus === 'function') {
                el.focus();
              }
            }).catch(() => {});
            await new Promise((r) => setTimeout(r, 300));
            
            const entered = await typeIntoEditable(page, promptField, prompt);
            
            if (entered) {
              promptEntered = true;
              await new Promise((r) => setTimeout(r, 500));
            } else {
              promptField = null;
            }
          }
        }
      } catch (e) {
      }
      
      if (!promptEntered) {
        const fallbackSelectors = [
          'rich-textarea .ql-editor',
          'rich-textarea [contenteditable="true"]',
          'rich-textarea div[role="textbox"]',
          '[contenteditable="true"][role="textbox"]',
          '.ql-editor[contenteditable="true"]',
        ];
        
        for (const selector of fallbackSelectors) {
          try {
            promptField = await page.$(selector);
            if (promptField) {
              await promptField.evaluateHandle((el) => {
                if (el && typeof el.focus === 'function') {
                  el.focus();
                }
              }).catch(() => {});
              await new Promise((r) => setTimeout(r, 300));
              
              const entered = await typeIntoEditable(page, promptField, prompt);
              if (entered) {
                promptEntered = true;
                await new Promise((r) => setTimeout(r, 500));
                break;
              }
            }
          } catch (e) {
          }
        }
      }
      
      if (!promptEntered) {
        logger.error({}, '[SendNextPrompt] Không thể nhập prompt vào textarea');
        await logService.logWarning(entityType, entityID, userID, 'prompt_sending_step', 
          'Không thể nhập prompt vào textarea', {});
      }

      let responseFinishedPromise = null;
      let cdpSession = null;
      let streamGenerateDetected = false;
      
      responseFinishedPromise = new Promise((resolve, reject) => {
        try {
          const client = page._client();
          cdpSession = client;
          
          client.send('Network.enable').catch(() => {});
          
          let targetRequestId = null;
          const timeout = setTimeout(() => {
            if (!streamGenerateDetected) {
              reject(new Error('Timeout waiting for StreamGenerate request'));
            } else {
              resolve(true);
            }
          }, 60000);
          
          client.on('Network.responseReceived', (event) => {
            const { response } = event;
            if (response.url.includes('StreamGenerate') && response.status === 200) {
              targetRequestId = event.requestId;
              streamGenerateDetected = true;
              clearTimeout(timeout);
              if (onProgress) {
                onProgress('gemini_generating', 'Đã gửi prompt, đang chờ Gemini tạo kịch bản', {});
              }
            }
          });
          
          client.on('Network.loadingFinished', (event) => {
            if (event.requestId === targetRequestId && targetRequestId) {
              clearTimeout(timeout);
              resolve(true);
            }
          });
        } catch (e) {
          reject(e);
        }
      });
      
      const submitted = await page.evaluate(() => {
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
            }
          }
        }
        
        return false;
      });
      
      if (submitted) {
        await new Promise((r) => setTimeout(r, 500));
      } else {
        await page.keyboard.press('Enter');
        await new Promise((r) => setTimeout(r, 500));
      }

      if (responseFinishedPromise) {
        try {
          await responseFinishedPromise;
          
          await new Promise((r) => setTimeout(r, 2000));
          
          await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
          });
          await new Promise((r) => setTimeout(r, 500));
          
          await new Promise((r) => setTimeout(r, 2000));
          
          const extractResult = await extractTextFromGemini(page, browser, userDataDir);
          
          if (extractResult.success && extractResult.text) {
            copiedText = extractResult.text;
            await logService.logSuccess(entityType, entityID, userID, 'prompt_sending_step', 
              'Đã extract text thành công từ Gemini', {
                text_length: copiedText.length
              });
            
            if (onProgress) {
              onProgress('gemini_completed', 'Gemini đã tạo kịch bản xong', {});
            }
            
            if (onProgress) {
              onProgress('text_copied', 'Đã copy text từ Gemini', {
                text: copiedText,
                text_length: copiedText.length
              });
            }
          } else {
            await logService.logWarning(entityType, entityID, userID, 'prompt_sending_step', 
              'Không thể extract text từ Gemini', {
                error: extractResult.error || 'Unknown error'
              });
          }
          
          if (cdpSession) {
            try {
              await cdpSession.send('Network.disable').catch(() => {});
            } catch (e) {
              // Ignore cleanup errors
            }
          }
        } catch (e) {
          await logService.logError(entityType, entityID, userID, 'prompt_sending_step', 
            `Lỗi khi đợi response hoặc extract text: ${e?.message || String(e)}`, {
              error: e?.message || String(e)
            });
          
          if (cdpSession) {
            try {
              await cdpSession.send('Network.disable').catch(() => {});
            } catch (cleanupErr) {
            }
          }
        }
      } else {
        await logService.logWarning(entityType, entityID, userID, 'prompt_sending_step', 
          'responseFinishedPromise không được setup', {});
      }
    }

    status = 'success';
    
    await logService.logSuccess(entityType, entityID, userID, 'prompt_sending_step', 
      'Hoàn thành gửi prompt tiếp theo', {
        has_response: !!copiedText,
        text_length: copiedText?.length || 0
      });
    
    return { status, copiedText: copiedText || null };
  } catch (e) {
    logger.error({ error: e.message }, '[SendNextPrompt] Lỗi');
    
    await logService.logError(entityType, entityID, userID, 'prompt_sending_step', 
      `Lỗi khi gửi prompt tiếp theo: ${e?.message || String(e)}`, {
        error: e?.message || String(e)
      });
    
    return { status: 'failed', error: e?.message || String(e) };
  } finally {
    // KHÔNG disconnect browser để có thể reuse cho lần sau
    // Browser sẽ được disconnect khi không còn sử dụng nữa (khi exit hoặc khi project kết thúc)
  }
}

module.exports = { sendPrompt, sendNextPrompt };



