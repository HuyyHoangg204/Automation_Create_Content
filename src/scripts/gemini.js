const { logger } = require('../logger');
const { connectToBrowserByUserDataDir } = require('./gmailLogin');
const logService = require('../services/logService');

async function clickByText(page, texts, options = {}) {
  const timeoutMs = options.timeoutMs || 10000;
  const deadline = Date.now() + timeoutMs;
  const candidates = Array.isArray(texts) ? texts : [texts];
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const clicked = await page.evaluate((arr) => {
      const candidates = Array.from(document.querySelectorAll('button, [role="button"], a, span, div'));
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
      for (const el of candidates) {
        const text = norm(el.innerText || el.textContent || '');
        for (const t of arr) {
          if (text === t || text.includes(t)) {
            try {
              el.scrollIntoView({ block: 'center', inline: 'center' });
              (el).click();
              return true;
            } catch (e) { /* ignore */ }
          }
        }
      }
      return false;
    }, candidates);
    if (clicked) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function clickSelectors(page, selectors, options = {}) {
  const timeoutMs = options.timeoutMs || 10000;
  const deadline = Date.now() + timeoutMs;
  const list = Array.isArray(selectors) ? selectors : [selectors];
  while (Date.now() < deadline) {
    for (const sel of list) {
      // eslint-disable-next-line no-await-in-loop
      const el = await page.$(sel);
      if (el) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await el.evaluate((e) => e.scrollIntoView({ block: 'center', inline: 'center' }));
          // eslint-disable-next-line no-await-in-loop
          await el.click();
          return true;
        } catch (_) { /* ignore */ }
      }
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function dismissOnboarding(page, options = {}) {
  const rounds = options.rounds || 6;
  for (let i = 0; i < rounds; i += 1) {
    // Try common close buttons/texts
    // eslint-disable-next-line no-await-in-loop
    const clicked = await clickSelectors(page, [
      'button[aria-label="Dismiss"]',
      'button[aria-label*="Dismiss" i]',
      'button[aria-label="Close"]',
      'button[aria-label*="Close" i]',
    ], { timeoutMs: 500 }) || await clickByText(page, [
      'Got it', 'Đã hiểu', 'Ok', 'OK', 'Close', 'Đóng', 'No, thanks', 'Không, cảm ơn',
    ], { timeoutMs: 500 });
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 200));
    if (!clicked) {
      // Send Escape just in case a dialog is active
      // eslint-disable-next-line no-await-in-loop
      await page.keyboard.press('Escape').catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 150));
    }
  }
}

const fs = require('fs');

async function typeInto(page, handle, text) {
  if (!handle) return false;
  try {
    await handle.focus();
    await handle.click({ clickCount: 3 }).catch(() => {});
    await handle.type(text, { delay: 10 });
    return true;
  } catch (_) { return false; }
}

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

async function pasteInto(page, handle, text) {
  if (!handle) return false;
  try {
    // Set clipboard data in page context
    await page.evaluate((textToPaste) => {
      navigator.clipboard.writeText(textToPaste).catch(() => {
        // Fallback: use execCommand
        const textarea = document.createElement('textarea');
        textarea.value = textToPaste;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      });
    }, text);
    
    await new Promise((r) => setTimeout(r, 100));
    
    await handle.focus();
    await handle.click({ clickCount: 3 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 100));
    
    await page.keyboard.down('Control');
    await page.keyboard.press('v');
    await page.keyboard.up('Control');
    
    await new Promise((r) => setTimeout(r, 200));
    return true;
  } catch (_) { return false; }
}

async function pasteIntoEditable(page, handle, text) {
  if (!handle) return false;
  try {
    // Set clipboard data in page context
    await page.evaluate((textToPaste) => {
      navigator.clipboard.writeText(textToPaste).catch(() => {
        // Fallback: use execCommand
        const textarea = document.createElement('textarea');
        textarea.value = textToPaste;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      });
    }, text);
    
    await new Promise((r) => setTimeout(r, 100));
    
    await handle.focus();
    
    // Select all existing content
    await handle.evaluate((el) => {
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (e) {
        // Ignore
      }
    });
    
    await new Promise((r) => setTimeout(r, 100));
    
    await page.keyboard.down('Control');
    await page.keyboard.press('v');
    await page.keyboard.up('Control');
    
    // Trigger input event
    await handle.evaluate((el) => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    
    await new Promise((r) => setTimeout(r, 200));
    return true;
  } catch (_) { return false; }
}

async function findFieldByPlaceholders(page, placeholders) {
  for (const ph of placeholders) {
    // eslint-disable-next-line no-await-in-loop
    const el = await page.$(`input[placeholder*="${ph}" i], textarea[placeholder*="${ph}" i]`);
    if (el) return el;
  }
  return null;
}

async function findFieldByLabel(page, labelTexts) {
  // Try to find an element that contains the label text, then the following input/textarea/contenteditable
  return page.evaluateHandle((labels) => {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = norm(node.textContent || '');
      if (labels.some((l) => text.includes(norm(l)))) {
        // search descendants and next siblings for fields
        const findField = (root) => {
          const sel = 'input, textarea, [contenteditable="true"]';
          const f1 = root.querySelector(sel);
          if (f1) return f1;
          let sib = root.nextElementSibling;
          for (let i = 0; i < 3 && sib; i += 1) {
            const f2 = sib.querySelector(sel);
            if (f2) return f2;
            sib = sib.nextElementSibling;
          }
          return null;
        };
        const f = findField(node);
        if (f) return f;
      }
    }
    return null;
  }, labelTexts);
}

async function uploadKnowledgeFiles(page, files) {
  if (!files || !files.length) return false;
  // 1) Preferred path: click the plus in Knowledge -> catch filechooser -> accept() files immediately.
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

    // Click the small plus in Knowledge footer (NOT the 'Add from Drive' item)
    const clickedPlus = await clickSelectors(page, [
      'button[data-test-id="bot-uploader-button"]',
      'div.file-upload-footer button'
    ], { timeoutMs: 3000 }).catch(() => false);

    // Wait for menu to appear
    await new Promise((r) => setTimeout(r, 500));

    // Click "Upload files" menu item (Gemini will try to click input, but our patch prevents OS dialog)
    const clickedUploadItem = await clickSelectors(page, [
      'button[data-test-id="local-images-files-uploader-button"]',
      'button[aria-label="Upload files"]',
      'button[aria-label*="Upload" i]',
    ], { timeoutMs: 3000 }).catch(() => false);
    
    if (!clickedUploadItem) {
      // Fallback: try clicking by text
      await clickByText(page, ['Upload files', 'Tải tệp lên'], { timeoutMs: 2000 }).catch(() => false);
    }

    // Wait for input to be created (Gemini will try to click it, but our patch prevents OS dialog)
    await new Promise((r) => setTimeout(r, 500));

    // Step 2: Find the input that Gemini created (should be in DOM now, no OS dialog opened)
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
      // Step 3: Use Puppeteer uploadFile() to upload files (no OS dialog because click is patched)
      try {
        await fileInput.uploadFile(...existing);
        
        // Step 4: Trigger change event to notify Gemini handlers
        await page.evaluate((sel) => {
          const input = document.querySelector(sel);
          if (input) {
            input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, foundSelector);
        
        // Step 5: Restore original click method
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
        // Continue to fallback
      }
    } else {
      // Restore original click method if input not found
      await page.evaluate(() => {
        if (window.__puppeteer_patched_input_click) {
          HTMLInputElement.prototype.click = window.__puppeteer_patched_input_click;
          delete window.__puppeteer_patched_input_click;
        }
      });
    }
  } catch (e) {
    // Restore original click method on error
    await page.evaluate(() => {
      if (window.__puppeteer_patched_input_click) {
        HTMLInputElement.prototype.click = window.__puppeteer_patched_input_click;
        delete window.__puppeteer_patched_input_click;
      }
    }).catch(() => {});
    // Continue to fallback
  }

  // 2) Fallback: try to locate hidden input and set files directly (may not always be present)
  // Ensure patch is still active for fallback
  await page.evaluate(() => {
    if (!window.__puppeteer_patched_input_click) {
      const originalClick = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function() {
        if (this.type === 'file') {
          return;
        }
        return originalClick.call(this);
      };
      window.__puppeteer_patched_input_click = originalClick;
    }
  });

  let input = await page.$([
    'div.editor-container.hide-on-mobile-preview input[type="file"]',
    'div.editor-container-inner input[type="file"]',
    'div.knowledge-files-content input[type="file"]',
    'input.hidden-local-upload-button',
    'input[class*="hidden-local-"][type="file"]',
    'input[type="file"]'
  ].join(', '));
  if (!input) {
    await new Promise((r) => setTimeout(r, 400));
    input = await page.$('input[type="file"], input.hidden-local-upload-button');
  }
  if (!input) {
    // Restore original click method
    await page.evaluate(() => {
      if (window.__puppeteer_patched_input_click) {
        HTMLInputElement.prototype.click = window.__puppeteer_patched_input_click;
        delete window.__puppeteer_patched_input_click;
      }
    }).catch(() => {});
    return false;
  }
  try {
    if (input.uploadFile) {
      await input.uploadFile(...existing);
    } else if (page.setInputFiles) {
      await page.setInputFiles(input, existing);
    }
    
    // Restore original click method
    await page.evaluate(() => {
      if (window.__puppeteer_patched_input_click) {
        HTMLInputElement.prototype.click = window.__puppeteer_patched_input_click;
        delete window.__puppeteer_patched_input_click;
      }
    }).catch(() => {});
    
    return true;
  } catch (e) {
    // Restore original click method on error
    await page.evaluate(() => {
      if (window.__puppeteer_patched_input_click) {
        HTMLInputElement.prototype.click = window.__puppeteer_patched_input_click;
        delete window.__puppeteer_patched_input_click;
      }
    }).catch(() => {});
    
    // Try FileChooser flow (should not trigger OS dialog if patch is active)
    try {
      const chooserPromise = new Promise((resolve) => page.once('filechooser', resolve));
      const fileChooser = await Promise.race([
        chooserPromise,
        new Promise((resolve, reject) => setTimeout(() => reject(new Error('no filechooser')), 3000)),
      ]);
      if (fileChooser) {
        await fileChooser.accept(existing);
        
        // Restore original click method
        await page.evaluate(() => {
          if (window.__puppeteer_patched_input_click) {
            HTMLInputElement.prototype.click = window.__puppeteer_patched_input_click;
            delete window.__puppeteer_patched_input_click;
          }
        }).catch(() => {});
        
        return true;
      }
    } catch (e2) {
      // Ignore
    }
    
    // Restore original click method
    await page.evaluate(() => {
      if (window.__puppeteer_patched_input_click) {
        HTMLInputElement.prototype.click = window.__puppeteer_patched_input_click;
        delete window.__puppeteer_patched_input_click;
      }
    }).catch(() => {});
    
    return false;
  }
}

async function createGem({ userDataDir, name, description, instructions, knowledgeFiles, debugPort, entityType = 'topic', entityID = 'unknown', userID = 'unknown' }) {
  const { browser } = await connectToBrowserByUserDataDir(userDataDir, debugPort);
  let status = 'unknown';
  let page = null;
  try {
    await logService.logInfo(entityType, entityID, userID, 'gem_creating_step', 
      'Đang kết nối đến Chrome và mở trang Gemini', {
      gem_name: name || 'unknown'
    });
    
    page = await browser.newPage();

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

    await logService.logInfo(entityType, entityID, userID, 'gem_creating_step', 
      'Đang điều hướng đến trang Gemini', {
      gem_name: name || 'unknown'
    });
    
    await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const host = (() => { try { return new URL(page.url()).hostname; } catch { return ''; } })();
    logger.info({ url: page.url(), host }, '[Gemini] Navigated to Gemini app');
    
    if (host.includes('accounts.google.com')) {
      status = 'not_logged_in';
      logger.warn({ url: page.url() }, '[Gemini] Not logged in, redirected to accounts.google.com');
      await logService.logError(entityType, entityID, userID, 'gem_creating_step', 
        'Chưa đăng nhập Gmail, không thể tạo Gem', {
        gem_name: name || 'unknown',
        redirect_url: page.url()
      });
      return { status };
    }
    
    await logService.logInfo(entityType, entityID, userID, 'gem_creating_step', 
      'Đã vào trang Gemini, đang tìm nút tạo Gem mới', {
      gem_name: name || 'unknown'
    });

    // Click bot list side nav entry button (new UI - replaces Explore Gems)
    // IMPORTANT: Only click element with exact data-test-id="bot-list-side-nav-entry-button"
    let clickedExploreBySelectors = false;
    try {
      // Wait for the specific button to appear (don't require visible, as it might be hidden in closed sidebar)
      const botListButton = await page.waitForSelector(
        'side-nav-entry-button[data-test-id="bot-list-side-nav-entry-button"]',
        { timeout: 12000 }
      ).catch(() => null);
      
      if (botListButton) {
        // Get detailed info about the button
        const buttonDetails = await botListButton.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return {
            dataTestId: el.getAttribute('data-test-id'),
            text: (el.textContent || el.innerText || '').trim(),
            disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
            visible: el.offsetParent !== null,
            boundingRect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              top: rect.top,
              left: rect.left,
              bottom: rect.bottom,
              right: rect.right
            },
            styles: {
              display: style.display,
              visibility: style.visibility,
              opacity: style.opacity,
              pointerEvents: style.pointerEvents,
              zIndex: style.zIndex,
              position: style.position
            },
            tagName: el.tagName,
            className: el.className,
            id: el.id
          };
        });
        
        // Verify it has the correct data-test-id before clicking
        const dataTestId = buttonDetails.dataTestId;
        
        if (dataTestId === 'bot-list-side-nav-entry-button') {
          // Check if button is hidden (sidebar might be closed)
          const isHidden = buttonDetails.styles.visibility === 'hidden' || 
                          buttonDetails.styles.display === 'none' || 
                          buttonDetails.styles.opacity === '0' ||
                          !buttonDetails.visible;
          
          // If button is hidden, click hamburger menu to open sidebar
          if (isHidden) {
            try {
              const menuButton = await page.$('button[data-test-id="side-nav-menu-button"]');
              if (menuButton) {
                await menuButton.click({ timeout: 3000 });
                await new Promise((r) => setTimeout(r, 500));
                
                // Wait for button to become visible
                await page.waitForFunction(
                  (selector) => {
                    const el = document.querySelector(selector);
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    return style.visibility !== 'hidden' && 
                           style.display !== 'none' && 
                           style.opacity !== '0' &&
                           el.offsetParent !== null;
                  },
                  { timeout: 5000 },
                  'side-nav-entry-button[data-test-id="bot-list-side-nav-entry-button"]'
                ).catch(() => {});
              }
            } catch (_) {}
          }
          
          await botListButton.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
          await new Promise((r) => setTimeout(r, 300));
          
          try {
            await botListButton.click({ timeout: 2000 });
            clickedExploreBySelectors = true;
          } catch (_) {}
        }
      }
    } catch (_) {}
    
    // Fallback: try generic selector but verify data-test-id
    if (!clickedExploreBySelectors) {
      try {
        const allButtons = await page.$$('side-nav-entry-button');
        
        for (let i = 0; i < allButtons.length; i++) {
          const btn = allButtons[i];
          
          const buttonInfo = await btn.evaluate((el) => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return {
              dataTestId: el.getAttribute('data-test-id'),
              text: (el.textContent || el.innerText || '').trim(),
              disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
              visible: el.offsetParent !== null,
              boundingRect: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
              },
              styles: {
                display: style.display,
                visibility: style.visibility,
                opacity: style.opacity,
                pointerEvents: style.pointerEvents
              }
            };
          });
          
          const dataTestId = buttonInfo.dataTestId;
          if (dataTestId === 'bot-list-side-nav-entry-button') {
            // Check if button is hidden
            const isHidden = buttonInfo.styles.visibility === 'hidden' || 
                            buttonInfo.styles.display === 'none' || 
                            buttonInfo.styles.opacity === '0' ||
                            !buttonInfo.visible;
            
            // If button is hidden, click hamburger menu to open sidebar
            if (isHidden) {
              try {
                const menuButton = await page.$('button[data-test-id="side-nav-menu-button"]');
                if (menuButton) {
                  await menuButton.click({ timeout: 3000 });
                  await new Promise((r) => setTimeout(r, 500));
                  
                  // Wait for button to become visible
                  try {
                    await page.waitForFunction(
                      (selector) => {
                        const el = document.querySelector(selector);
                        if (!el) return false;
                        const style = window.getComputedStyle(el);
                        return style.visibility !== 'hidden' && 
                               style.display !== 'none' && 
                               style.opacity !== '0' &&
                               el.offsetParent !== null;
                      },
                      { timeout: 5000 },
                      'side-nav-entry-button[data-test-id="bot-list-side-nav-entry-button"]'
                    );
                  } catch (_) {}
                }
              } catch (_) {}
            }
            
            const isVisible = await btn.isVisible();
            
            if (isVisible) {
              await btn.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
              await new Promise((r) => setTimeout(r, 300));
              
              try {
                await btn.click({ timeout: 2000 });
                clickedExploreBySelectors = true;
                break;
              } catch (_) {}
            }
          }
        }
      } catch (_) {}
    }
    
    let clickedExplore = clickedExploreBySelectors;
    if (!clickedExplore) {
      // Fallback: try old Explore Gems selectors in case UI hasn't fully updated
      clickedExplore = await clickSelectors(page, [
        'button[aria-label="Explore Gems"]',
        'button[aria-label*="Explore Gems" i]',
        '[aria-label="Explore Gems"]',
      ], { timeoutMs: 5000 });
      if (!clickedExplore) {
        clickedExplore = await clickByText(page, ['Explore Gems', 'Khám phá Gems'], { timeoutMs: 5000 });
      }
    }
    await Promise.race([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
      new Promise((r) => setTimeout(r, 1200)),
    ]);

    // Try click New Gem button inside Gem manager
    let clickedNew = false;
    if (clickedExplore) {
      await logService.logInfo(entityType, entityID, userID, 'gem_creating_step', 
        'Đã mở Gem manager, đang tìm nút New Gem', {
        gem_name: name || 'unknown'
      });
      logger.info({}, '[Gemini] Looking for New Gem button');
      // Debug: Check if New Gem button exists
      const newGemInfo = await page.evaluate(() => {
        const selectors = [
          '[data-test-id="open-bots-creation-button"]',
          'button[data-test-id*="open-bots-creation"]',
          'button[data-test-id*="creation"]',
          'button.mat-mdc-button-base.bot-creation-button',
        ];
        const results = {};
        for (const sel of selectors) {
          const els = Array.from(document.querySelectorAll(sel));
          results[sel] = els.map(el => ({
            visible: el.offsetParent !== null,
            text: (el.textContent || el.innerText || '').trim(),
            dataTestId: el.getAttribute('data-test-id'),
            disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
            tagName: el.tagName,
            className: el.className
          }));
        }
        // Also check by text
        const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
        const newGemTexts = allButtons.filter(el => {
          const text = (el.textContent || el.innerText || '').trim();
          return /new gem|create new gem|create a gem|tạo gem|tạo mới/i.test(text);
        }).map(el => ({
          visible: el.offsetParent !== null,
          text: (el.textContent || el.innerText || '').trim(),
          disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
          tagName: el.tagName,
          className: el.className
        }));
        results.byText = newGemTexts;
        return results;
      });
      logger.info({ newGemInfo }, '[Gemini] New Gem button search results');
      logger.info({}, '[Gemini] Attempting to click New Gem by selectors');
      clickedNew = await clickSelectors(page, [
        '[data-test-id="open-bots-creation-button"]',
        'button[data-test-id*="open-bots-creation"]',
        'button[data-test-id*="creation"]',
        'button.mat-mdc-button-base.bot-creation-button',
      ], { timeoutMs: 8000 });
      logger.info({ clickedNew }, '[Gemini] Click New Gem by selectors result');
      
      if (!clickedNew) {
        logger.info({}, '[Gemini] Selectors failed, trying to click New Gem by text');
        clickedNew = await clickByText(page, ['New Gem', 'Create new Gem', 'Create a Gem', 'Tạo Gem', 'Tạo mới'], { timeoutMs: 6000 });
        logger.info({ clickedNew }, '[Gemini] Click New Gem by text result');
      }
      if (clickedNew) {
        await logService.logInfo(entityType, entityID, userID, 'gem_creating_step', 
          'Đã click New Gem, đang mở form tạo Gem', {
          gem_name: name || 'unknown'
        });
        
        await Promise.race([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
          new Promise((r) => setTimeout(r, 800)),
        ]);
        // Dismiss onboarding tooltips/modals if they appear
        await dismissOnboarding(page, { rounds: 6 });

        // Fill fields if provided
        if (name) {
          await logService.logInfo(entityType, entityID, userID, 'gem_creating_step', 
            'Đang điền tên Gem', {
            gem_name: name
          });
          // Prefer stable id if present
          let nameField = await page.$('#gem-name-input');
          if (!nameField) nameField = await findFieldByPlaceholders(page, ['Give your Gem a name', 'Name']);
          if (!nameField) nameField = await findFieldByLabel(page, ['Name']);
          if (nameField) await typeInto(page, nameField, name);
        }
        if (description) {
          await logService.logInfo(entityType, entityID, userID, 'gem_creating_step', 
            'Đang điền mô tả Gem', {
            gem_name: name || 'unknown'
          });
          let descField = await findFieldByPlaceholders(page, ['Describe your Gem', 'Description']);
          if (!descField) descField = await findFieldByLabel(page, ['Description']);
          if (descField) await pasteInto(page, descField, description);
        }
        if (instructions) {
          await logService.logInfo(entityType, entityID, userID, 'gem_creating_step', 
            'Đang điền hướng dẫn cho Gem', {
            gem_name: name || 'unknown'
          });
          // Prefer explicit instruction rich editor container
          let instField = await page.$('[data-test-id="instruction-rich-input-field"], div[role="textbox"][data-test-id*="instruction"]');
          if (!instField) instField = await findFieldByPlaceholders(page, ['Instructions']);
          if (!instField) instField = await findFieldByLabel(page, ['Instructions']);
          if (instField) {
            // Check if contenteditable
            const isEditable = await instField.evaluate((el) => el.isContentEditable === true || el.getAttribute('contenteditable') === 'true');
            if (isEditable) {
              await pasteIntoEditable(page, instField, instructions);
            } else {
              await pasteInto(page, instField, instructions);
            }
          }
        }
        let saveClicked = false;
        if (knowledgeFiles && knowledgeFiles.length) {
          await logService.logInfo(entityType, entityID, userID, 'gem_creating_step', 
            `Đang upload ${knowledgeFiles.length} file(s) vào Gem`, {
            gem_name: name || 'unknown',
            files_count: knowledgeFiles.length
          });
          const ok = await uploadKnowledgeFiles(page, knowledgeFiles);
					if (ok) {
						// Wait until Save button becomes enabled/visible, then click it (no fixed timeout)
						const candidates = [
							'button[data-test-id="save-button"]',
							'button[aria-label="Save"]',
							'button[aria-label*="Save" i]',
							'button.save-button'
						];
						try {
							await page.waitForFunction((sels) => {
								const enabled = (el) => {
									if (!el) return false;
									const disabledAttr = el.getAttribute('disabled');
									const ariaDisabled = el.getAttribute('aria-disabled');
									const classDisabled = (el.className || '').toLowerCase().includes('disabled');
									const isHidden = !(el.offsetParent || el.getClientRects().length);
									return !disabledAttr && ariaDisabled !== 'true' && !classDisabled && !isHidden;
								};
								for (const s of sels) {
									const el = document.querySelector(s);
									if (enabled(el)) return true;
								}
								// Fallback by text
								const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
								for (const el of btns) {
									const txt = (el.innerText || el.textContent || '').trim();
									if ((/^(Save|Lưu)$/i).test(txt) && enabled(el)) return true;
								}
								return false;
							}, { timeout: 30000 }, candidates);
						} catch (_) {
							// If it didn't become enabled in time, still try clicking optimistically
						}
						await logService.logInfo(entityType, entityID, userID, 'gem_creating_step', 
						  'Đang chờ nút Save sẵn sàng và click Save', {
						  gem_name: name || 'unknown'
						});
						
						saveClicked = await clickSelectors(page, candidates, { timeoutMs: 5000 })
							|| await clickByText(page, ['Save', 'Lưu'], { timeoutMs: 5000 });
						
						// Đợi một chút sau khi click Save để xem có navigation hoặc thay đổi không
						if (saveClicked) {
							await logService.logInfo(entityType, entityID, userID, 'gem_creating_step', 
							  'Đã click Save, đang chờ Gem được lưu', {
							  gem_name: name || 'unknown'
							});
							
							await Promise.race([
								page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {}),
								new Promise((r) => setTimeout(r, 2000))
							]);
						}
					}
        } else {
          // Không có files, vẫn cần click Save nếu có name/description/instructions
          if (name || description || instructions) {
            const candidates = [
              'button[data-test-id="save-button"]',
              'button[aria-label="Save"]',
              'button[aria-label*="Save" i]',
              'button.save-button'
            ];
            try {
              await page.waitForFunction((sels) => {
                const enabled = (el) => {
                  if (!el) return false;
                  const disabledAttr = el.getAttribute('disabled');
                  const ariaDisabled = el.getAttribute('aria-disabled');
                  const classDisabled = (el.className || '').toLowerCase().includes('disabled');
                  const isHidden = !(el.offsetParent || el.getClientRects().length);
                  return !disabledAttr && ariaDisabled !== 'true' && !classDisabled && !isHidden;
                };
                for (const s of sels) {
                  const el = document.querySelector(s);
                  if (enabled(el)) return true;
                }
                return false;
              }, { timeout: 10000 }, candidates);
            } catch (_) {
              // Ignore
            }
            saveClicked = await clickSelectors(page, candidates, { timeoutMs: 5000 })
              || await clickByText(page, ['Save', 'Lưu'], { timeoutMs: 5000 });
            
            if (saveClicked) {
              await Promise.race([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {}),
                new Promise((r) => setTimeout(r, 2000))
              ]);
            }
          }
        }
        
        // Xác định status dựa trên kết quả
        if (clickedNew && saveClicked) {
          status = 'gem_created';
          await logService.logSuccess(entityType, entityID, userID, 'gem_creating_step', 
            'Gem đã được tạo và lưu thành công', {
            gem_name: name || 'unknown'
          });
        } else if (clickedNew && !saveClicked) {
          status = 'gem_form_filled_but_not_saved';
          await logService.logWarning(entityType, entityID, userID, 'gem_creating_step', 
            'Form đã được điền nhưng không thể click Save', {
            gem_name: name || 'unknown'
          });
        } else {
          status = clickedNew ? 'new_gem_clicked' : (clickedExplore ? 'opened_explore' : 'noop');
          await logService.logWarning(entityType, entityID, userID, 'gem_creating_step', 
            `Không thể hoàn tất tạo Gem: ${status}`, {
            gem_name: name || 'unknown',
            status
          });
        }
      } else {
        await logService.logWarning(entityType, entityID, userID, 'gem_creating_step', 
          'Không thể mở form tạo Gem mới', {
          gem_name: name || 'unknown',
          clickedExplore
        });
      }
    }

    return { status };
  } catch (e) {
    await logService.logError(entityType, entityID, userID, 'gem_creating_step', 
      `Lỗi khi tạo Gem: ${e?.message || String(e)}`, {
      gem_name: name || 'unknown',
      error: e?.message || String(e)
    });
    return { status: 'failed', error: e?.message || String(e) };
  } finally {
    try {
      // Restore original click method if patched
      if (page && !page.isClosed()) {
        await page.evaluate(() => {
          if (window.__puppeteer_patched_input_click) {
            HTMLInputElement.prototype.click = window.__puppeteer_patched_input_click;
            delete window.__puppeteer_patched_input_click;
          }
        }).catch(() => {});
      }
    } catch (_) {}
    try { browser.disconnect(); } catch (_) {}
  }
}

// Export helper functions for use in other scripts
module.exports = { 
  createGem,
  clickByText,
  clickSelectors,
  uploadKnowledgeFiles,
};


