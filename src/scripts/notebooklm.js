const { logger } = require('../logger');
const { connectToBrowserByUserDataDir } = require('./gmailLogin');
const logService = require('../services/logService');
const fs = require('fs');
const path = require('path');

/**
 * Launch NotebookLM in an existing Chrome profile.
 * If the user is not logged in, it will return status 'not_logged_in'.
 * If welcome popup appears (new account), it will be dismissed automatically.
 * Then clicks "Create new notebook" button if found.
 * If website (array of URLs), youtube (array of URLs), or textContent is provided, adds them as sources.
 * Website URLs are entered into textarea #mat-input-1, one URL per line, then insert once.
 * YouTube URLs are inserted one by one: for each URL, click Add source, click YouTube chip, enter URL, click Insert.
 * If prompt is provided, enters it into the prompt textarea after all sources are added.
 * If outputFile is provided, intercepts GenerateFreeFormStreamed API response and saves it to file.
 * Returns 'notebook_created' if button was clicked, 'launched' otherwise.
 */
async function launchNotebookLM({ userDataDir, debugPort, website, youtube, textContent, prompt, outputFile, entityType = 'topic', entityID = 'unknown', userID = 'unknown' }) {
  const { browser } = await connectToBrowserByUserDataDir(userDataDir, debugPort);
  let status = 'unknown';
  try {
    await logService.logInfo(entityType, entityID, userID, 'notebooklm_step', 
      'Đang kết nối đến Chrome và mở NotebookLM', {});
    
    // Đóng các tab cũ để tránh quá nhiều tab (giữ lại 1 tab để browser không đóng)
    let page = null;
    try {
      const pages = await browser.pages();
      if (pages.length > 1) {
        // Đóng các tab từ sau về trước, giữ lại tab đầu tiên (index 0)
        for (let i = pages.length - 1; i > 0; i--) {
          try {
            if (!pages[i].isClosed()) {
              await pages[i].close();
            }
          } catch (closeError) {
            // Ignore errors when closing pages (might already be closed)
            logger.debug({ err: closeError }, 'notebooklm: error closing existing page');
          }
        }
        // Đợi một chút để các tab đóng xong
        await new Promise((r) => setTimeout(r, 300));
      }
      
      // Lấy lại danh sách pages sau khi đóng
      const remainingPages = await browser.pages();
      if (remainingPages.length > 0 && !remainingPages[0].isClosed()) {
        // Dùng tab còn lại
        page = remainingPages[0];
      } else {
        // Tạo tab mới nếu không còn tab nào
        page = await browser.newPage();
      }
    } catch (closeAllError) {
      logger.warn({ err: closeAllError }, 'notebooklm: error closing existing tabs, creating new page');
      // Tạo tab mới nếu có lỗi
      if (!page || page.isClosed()) {
        page = await browser.newPage();
      }
    }
    
    // Đảm bảo có page hợp lệ
    if (!page || page.isClosed()) {
      page = await browser.newPage();
    }
    await logService.logInfo(entityType, entityID, userID, 'notebooklm_step', 
      'Đang điều hướng đến trang NotebookLM', {});
    
    const url = 'https://notebooklm.google.com/';
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    const host = (() => { try { return new URL(page.url()).hostname; } catch { return ''; } })();
    if (host.includes('accounts.google.com')) {
      status = 'not_logged_in';
      await logService.logError(entityType, entityID, userID, 'notebooklm_step', 
        'Chưa đăng nhập Google, không thể truy cập NotebookLM', {
        redirect_url: page.url()
      });
      return { status, url: page.url() };
    }
    
    await logService.logInfo(entityType, entityID, userID, 'notebooklm_step', 
      'Đã vào trang NotebookLM, đang xử lý welcome popup nếu có', {});

    await new Promise((r) => setTimeout(r, 2000));
    try {
      const welcomePopup = await page.evaluate(() => {
        // Look for modal/dialog containing "Welcome to NotebookLM"
        const modals = Array.from(document.querySelectorAll('[role="dialog"], .modal, [class*="modal"], [class*="dialog"]'));
        for (const modal of modals) {
          const text = modal.textContent || '';
          if (text.includes('Welcome to NotebookLM') || text.includes('Welcome to NotebookLM!')) {
            return true;
          }
        }
        return false;
      });

      if (welcomePopup) {
        // Find and click OK button in the welcome modal
        const buttonClicked = await page.evaluate(() => {
          // First, find the modal containing "Welcome to NotebookLM"
          const modals = Array.from(document.querySelectorAll('[role="dialog"], .modal, [class*="modal"], [class*="dialog"]'));
          for (const modal of modals) {
            const text = modal.textContent || '';
            if (text.includes('Welcome to NotebookLM')) {
              // Find OK button in this modal
              const buttons = modal.querySelectorAll('button, [role="button"]');
              for (const btn of buttons) {
                const btnText = (btn.textContent || '').trim();
                if (btnText === 'OK' || btnText.toLowerCase() === 'ok') {
                  btn.click();
                  return true;
                }
              }
            }
          }
          // Fallback: search all buttons on page for OK
          const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
          for (const btn of allButtons) {
            const btnText = (btn.textContent || '').trim();
            if (btnText === 'OK' || btnText.toLowerCase() === 'ok') {
              btn.click();
              return true;
            }
          }
          return false;
        });

        if (buttonClicked) {
          await new Promise((r) => setTimeout(r, 1000));
        } else {
          logger.warn({}, 'notebooklm: welcome popup detected but could not dismiss');
        }
      }
    } catch (popupError) {
      logger.warn({ err: popupError }, 'notebooklm: error handling welcome popup, continuing');
    }

    // Click "Create new notebook" button
    try {
      await logService.logInfo(entityType, entityID, userID, 'notebooklm_step', 
        'Đang tìm và click nút "Create new notebook"', {});
      
      // Wait a bit after popup dismissal
      await new Promise((r) => setTimeout(r, 1000));
      
      // Try to find and click using Puppeteer selectors (more reliable)
      let createClicked = false;
      
      // Priority 1: Try mat-card with create-new-action-button class
      try {
        // Wait for element to appear
        await page.waitForSelector('mat-card.create-new-action-button, .create-new-action-button', { 
          timeout: 5000,
          visible: true 
        }).catch(() => {
          logger.debug({}, 'notebooklm: create-new-action-button not found within timeout');
        });
        
        let matCard = await page.$('mat-card.create-new-action-button[role="button"]');
        if (!matCard) {
          matCard = await page.$('mat-card.create-new-action-button');
        }
        if (!matCard) {
          matCard = await page.$('[class*="create-new-action-button"][role="button"]');
        }
        
        if (matCard) {
          // Scroll into view first
          await matCard.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
          await new Promise((r) => setTimeout(r, 500));
          
          const isVisible = await matCard.isVisible();
          if (isVisible) {
            await matCard.click({ timeout: 2000 });
            createClicked = true;
          } else {
            logger.debug({}, 'notebooklm: mat-card found but not visible');
          }
        } else {
          logger.debug({}, 'notebooklm: mat-card.create-new-action-button not found');
        }
      } catch (e) {
        logger.debug({ err: e }, 'notebooklm: failed to click mat-card selector');
      }
      
      // Priority 2: Try any element with create-new-action-button class
      if (!createClicked) {
        try {
          const actionButton = await page.$('.create-new-action-button');
          if (actionButton) {
            const isVisible = await actionButton.isVisible();
            if (isVisible) {
              await actionButton.click({ timeout: 2000 });
              createClicked = true;
            }
          }
        } catch (e) {
          logger.debug({ err: e }, 'notebooklm: failed to click .create-new-action-button');
        }
      }
      
      // Priority 3: Try mat-card with role="button" containing text
      if (!createClicked) {
        try {
          const matCards = await page.$$('mat-card[role="button"]');
          for (const card of matCards) {
            const text = await card.evaluate((el) => (el.textContent || '').trim());
            if (text.includes('Create new notebook')) {
              const isVisible = await card.isVisible();
              if (isVisible) {
                await card.click({ timeout: 2000 });
                createClicked = true;
                break;
              }
            }
          }
        } catch (e) {
          logger.debug({ err: e }, 'notebooklm: failed to click mat-card by text');
        }
      }
      
      // Priority 4: Fallback to evaluate if Puppeteer selectors fail
      if (!createClicked) {
        const result = await page.evaluate(() => {
          const matCard = document.querySelector('mat-card.create-new-action-button[role="button"]') ||
                         document.querySelector('mat-card.create-new-action-button') ||
                         document.querySelector('.create-new-action-button');
          
          if (matCard) {
            const style = window.getComputedStyle(matCard);
            if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
              matCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
              matCard.click();
              return true;
            }
          }
          return false;
        });
        
        if (result) {
          createClicked = true;
        }
      }
      
      // Priority 5: Try to find button by Vietnamese text "Tạo sổ ghi chú mới" (when no notebooks exist yet)
      if (!createClicked) {
        try {
          // Wait a bit for page to fully load
          await new Promise((r) => setTimeout(r, 1000));
          
          // Try to find mat-card with text "Tạo sổ ghi chú mới"
          const vietnameseButton = await page.evaluateHandle(() => {
            // Find all mat-cards with role="button"
            const matCards = Array.from(document.querySelectorAll('mat-card[role="button"], mat-card'));
            for (const card of matCards) {
              const text = (card.textContent || card.innerText || '').trim();
              // Check for Vietnamese text
              if (text.includes('Tạo sổ ghi chú mới') || text.includes('tạo sổ ghi chú mới')) {
                const style = window.getComputedStyle(card);
                if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                  return card;
                }
              }
            }
            return null;
          });
          
          if (vietnameseButton && vietnameseButton.asElement) {
            const btnElement = vietnameseButton.asElement();
            if (btnElement) {
              const isVisible = await btnElement.isVisible();
              if (isVisible) {
                await btnElement.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
                await new Promise((r) => setTimeout(r, 500));
                await btnElement.click({ timeout: 2000 });
                createClicked = true;
              }
            }
          } else if (vietnameseButton) {
            // If asElement() doesn't work, try direct click
            try {
              await vietnameseButton.evaluate((el) => {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.click();
              });
              createClicked = true;
            } catch (e) {
              logger.debug({ err: e }, 'notebooklm: failed to click Vietnamese button via evaluate');
            }
          }
        } catch (e) {
          logger.debug({ err: e }, 'notebooklm: failed to find/click Vietnamese "Tạo sổ ghi chú mới" button');
        }
      }
      
      // Priority 6: Try to find any mat-card with create-new-action-button class by text content
      if (!createClicked) {
        try {
          const matCards = await page.$$('mat-card[role="button"], mat-card');
          for (const card of matCards) {
            const text = await card.evaluate((el) => (el.textContent || '').trim());
            // Check for both English and Vietnamese
            if (text.includes('Create new notebook') || 
                text.includes('Tạo sổ ghi chú mới') ||
                text.includes('tạo sổ ghi chú mới')) {
              const isVisible = await card.isVisible();
              if (isVisible) {
                await card.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
                await new Promise((r) => setTimeout(r, 500));
                await card.click({ timeout: 2000 });
                createClicked = true;
                break;
              }
            }
          }
        } catch (e) {
          logger.debug({ err: e }, 'notebooklm: failed to click mat-card by text content');
        }
      }

      if (createClicked) {
        await logService.logInfo(entityType, entityID, userID, 'notebooklm_step', 
          'Đã click "Create new notebook" thành công', {});
        
        await new Promise((r) => setTimeout(r, 2000));
        status = 'notebook_created';
        
        // Add sources if provided
        if (website || youtube || textContent) {
          await logService.logInfo(entityType, entityID, userID, 'notebooklm_step', 
            `Đang thêm sources: ${website?.length || 0} website(s), ${youtube?.length || 0} youtube(s), ${textContent ? 'text' : 'none'}`, {
            website_count: website?.length || 0,
            youtube_count: youtube?.length || 0,
            has_text: !!textContent
          });
          try {
            // Wait for "Add sources" modal to appear (it may already be open after Create new notebook)
            await page.waitForSelector('[role="dialog"], .modal, [class*="modal"], [class*="dialog"]', { 
              timeout: 10000,
              visible: true 
            }).catch(() => {
              logger.warn({}, 'notebooklm: Add sources modal not found');
            });
            
            await new Promise((r) => setTimeout(r, 1000));
            
            // Helper function to check if modal is open (by checking if mat-chips are visible)
            const isModalOpen = async () => {
              try {
                // Check if mat-chips exist and are visible (chips are inside the modal)
                const chips = await page.$$('mat-chip');
                if (chips.length > 0) {
                  // Check if at least one chip is visible
                  for (const chip of chips) {
                    const isVisible = await chip.isVisible().catch(() => false);
                    if (isVisible) return true;
                  }
                }
                // Fallback: check modal element
                const modal = await page.$('[role="dialog"], .modal, [class*="modal"], [class*="dialog"]');
                if (modal) {
                  const isVisible = await modal.isVisible().catch(() => false);
                  return isVisible;
                }
                return false;
              } catch {
                return false;
              }
            };
            
            // Add website source
            // Combine all URLs (Website + YouTube)
            const allUrls = [];
            if (website && Array.isArray(website)) allUrls.push(...website);
            if (youtube && Array.isArray(youtube)) allUrls.push(...youtube);

            if (allUrls.length > 0) {
              try {
                // Ensure "Add source" modal is open if not already
                const modalOpen = await isModalOpen();
                if (!modalOpen) {
                   // Support both English "Add source" and Vietnamese "Thêm nguồn"
                   const addSourceButton = await page.$('button[aria-label="Add source"], [aria-label="Add source"], button[aria-label="Thêm nguồn"], [aria-label="Thêm nguồn"]');
                   if (addSourceButton) {
                     await addSourceButton.click({ timeout: 2000 });
                     await new Promise((r) => setTimeout(r, 1500));
                     try {
                        await page.waitForSelector('[role="dialog"], .modal, [class*="modal"], [class*="dialog"]', { 
                          timeout: 5000,
                          visible: true 
                        });
                     } catch(err) { logger.debug({}, 'notebooklm: modal wait timeout'); }
                   }
                }
                
                // Find "Web/YouTube" button (Unified)
                // Strategy: Target 2nd button in .drop-zone-actions as verified by user
                try {
                  await page.waitForSelector('.drop-zone-actions button', { visible: true, timeout: 8000 });
                } catch (e) { 
                  logger.debug({err: e}, 'notebooklm: Timed out waiting for .drop-zone-actions');
                }

                let sourceButton = null;
                try {
                   sourceButton = await page.evaluateHandle(() => {
                      const dropZone = document.querySelector('.drop-zone-actions');
                      if (dropZone) {
                        const buttons = Array.from(dropZone.querySelectorAll('button'));
                        if (buttons.length >= 2) {
                          return buttons[1];
                        }
                      }
                      
                      // Fallback: search by class and text
                      const buttons = Array.from(document.querySelectorAll('add-sources-dialog button, [role="dialog"] button'));
                      for (const btn of buttons) {
                         const text = (btn.textContent || '').trim().toLowerCase();
                         const className = btn.className;
                         if (className.includes('drop-zone-icon-button') && 
                             (text.includes('trang web') || text.includes('website'))) {
                            return btn;
                         }
                      }
                      return null;
                   });
                   
                   if (sourceButton && sourceButton.asElement()) {
                     sourceButton = sourceButton.asElement();
                     logger.info({}, 'notebooklm: Source button FOUND');
                   } else {
                     sourceButton = null;
                     logger.warn({}, 'notebooklm: Source button NOT FOUND');
                   }

                } catch(e) { logger.error({err: e}, 'notebooklm: Error searching for source button'); }

                if (sourceButton) {
                   // Scroll and Click Source Button
                   await sourceButton.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
                   await new Promise((r) => setTimeout(r, 1000));
                   await sourceButton.click({ timeout: 5000 });
                   await new Promise((r) => setTimeout(r, 1500));
                   
                   // Find input textarea
                   // User specified: textarea with aria-label="Nhập URL" or formcontrolname="urls"
                   const urlTextarea = await page.$('textarea[formcontrolname="urls"], textarea[aria-label="Nhập URL"], textarea[aria-label="Input URL"]');
                   
                   if (urlTextarea) {
                     logger.info({}, 'notebooklm: URL textarea found');
                     await urlTextarea.click();
                     await new Promise((r) => setTimeout(r, 500));
                     
                     // Enter all URLs joined by newline
                     const urlsText = allUrls.join('\n');
                     await urlTextarea.type(urlsText, { delay: 10 });
                     await new Promise((r) => setTimeout(r, 1000));
                     
                     // Click Insert/Submit button
                     // Need robust finding for the "Insert" button in this new dialog
                     let insertClicked = false;
                     
                     // Try finding the primary action button in the dialog
                     const insertButton = await page.evaluateHandle(() => {
                        const dialogs = document.querySelectorAll('website-upload, youtube-upload, [role="dialog"]');
                        // Use the last open dialog usually
                        const currentDialog = dialogs[dialogs.length - 1]; 
                        if (!currentDialog) return null;
                        
                        const buttons = Array.from(currentDialog.querySelectorAll('button'));
                        for (const btn of buttons) {
                           const text = (btn.textContent || '').trim().toLowerCase();
                           const type = btn.getAttribute('type');
                           const ariaLabel = btn.getAttribute('aria-label') || '';
                           
                           // Common identifiers for submit buttons
                           if (['insert', 'chèn', 'add', 'thêm', 'submit'].some(k => text.includes(k) || ariaLabel.toLowerCase().includes(k))) {
                              return btn;
                           }
                           // If specific class 'submit-button' exists
                           if (btn.classList.contains('submit-button')) return btn;
                        }
                        
                        // Fallback: assume the last button is the submit button if it's not a "cancel" button
                        if (buttons.length > 0) {
                           const lastBtn = buttons[buttons.length - 1];
                           const lastText = (lastBtn.textContent || '').trim().toLowerCase();
                           if (!lastText.includes('hủy') && !lastText.includes('cancel') && !lastText.includes('close')) {
                              return lastBtn;
                           }
                        }
                        return null;
                     });

                     if (insertButton && insertButton.asElement()) {
                        await insertButton.asElement().click();
                        insertClicked = true;
                        logger.info({}, 'notebooklm: Insert button clicked');
                     } else {
                        // Fallback to old selectors if evaluate failed
                        const oldInsert = await page.$('button.submit-button, button[type="submit"]');
                        if (oldInsert) {
                           await oldInsert.click();
                           insertClicked = true;
                        }
                     }
                     
                     if (!insertClicked) {
                        logger.warn({}, 'notebooklm: Insert button not found after entering URLs');
                     } else {
                        // Wait for processing
                        await new Promise((r) => setTimeout(r, 3000));
                     }

                   } else {
                     logger.warn({}, 'notebooklm: URL textarea (formcontrolname="urls") not found');
                   }
                }
              } catch (e) {
                logger.error({err: e}, 'notebooklm: Error adding sources');
              }
            }
            // Add text content source
            if (textContent) {
              try {
                
                // Click "Add source" button only if modal is not open
                const modalOpen = await isModalOpen();
                if (!modalOpen) {
                  // Support both English "Add source" and Vietnamese "Thêm nguồn"
                  const addSourceButton = await page.$('button[aria-label="Add source"], [aria-label="Add source"], button[aria-label="Thêm nguồn"], [aria-label="Thêm nguồn"]');
                  if (addSourceButton) {
                    await addSourceButton.click({ timeout: 2000 });
                    await new Promise((r) => setTimeout(r, 1500));
                    // Wait for modal to appear
                    await page.waitForSelector('[role="dialog"], .modal, [class*="modal"], [class*="dialog"]', { 
                      timeout: 5000,
                      visible: true 
                    }).catch(() => {
                      logger.debug({}, 'notebooklm: modal not found after Add source click');
                    });
                  }
                } else {
                }
                
                // Find mat-chip containing "Copied text" or "Paste text" by text
                let textChip = null;
                const allChips = await page.$$('mat-chip');
                for (const chip of allChips) {
                  const text = await chip.evaluate((el) => (el.textContent || '').trim());
                  if (text === 'Copied text' || text.includes('Copied text') || 
                      text === 'Paste text' || text.includes('Paste text')) {
                    textChip = chip;
                    break;
                  }
                }
                
                if (textChip) {
                  // Scroll into view and click
                  await textChip.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
                  await new Promise((r) => setTimeout(r, 300));
                  await textChip.click({ timeout: 2000 });
                  
                  await new Promise((r) => setTimeout(r, 1500));
                  
                  // Wait for textarea to appear after clicking Copied text chip
                  await page.waitForSelector('textarea[formcontrolname="text"], textarea#mat-input-2', { 
                    timeout: 5000,
                    visible: true 
                  }).catch(() => {
                    logger.debug({}, 'notebooklm: textarea not found within timeout');
                  });
                  
                  // Find textarea for text content (prioritize formcontrolname="text", then ID as fallback)
                  let textInput = await page.$('textarea[formcontrolname="text"]');
                  if (!textInput) {
                    textInput = await page.$('textarea#mat-input-2');
                  }
                  if (!textInput) {
                    // Fallback: try any textarea with formcontrolname
                    textInput = await page.$('textarea[formcontrolname]');
                  }
                  
                  if (textInput) {
                    // Scroll into view first
                    await textInput.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
                    await new Promise((r) => setTimeout(r, 300));
                    
                    // Focus and click
                    await textInput.focus();
                    await textInput.click({ timeout: 2000 });
                    await new Promise((r) => setTimeout(r, 200));
                    
                    // Type text content
                    await textInput.type(textContent, { delay: 10 });
                    await new Promise((r) => setTimeout(r, 500));
                    
                    // Wait for Insert button to be enabled (button is disabled until text is entered)
                    await page.waitForFunction(
                      () => {
                        const buttons = Array.from(document.querySelectorAll('button[type="submit"], button.mat-flat-button, button'));
                        for (const btn of buttons) {
                          const text = (btn.textContent || '').trim();
                          if (text === 'Insert' || text.includes('Insert')) {
                            return !btn.disabled && !btn.hasAttribute('disabled');
                          }
                        }
                        return false;
                      },
                      { timeout: 5000 }
                    ).catch(() => {
                      logger.debug({}, 'notebooklm: Insert button not enabled within timeout');
                    });
                    
                    await new Promise((r) => setTimeout(r, 300));
                    
                    // Click Insert button
                    let insertClicked = false;
                    
                    // Priority 1: Find button by text "Insert" with type="submit"
                    try {
                      const buttons = await page.$$('button[type="submit"], button.mat-flat-button, button');
                      for (const btn of buttons) {
                        const text = await btn.evaluate((el) => (el.textContent || '').trim());
                        if (text === 'Insert' || text.includes('Insert')) {
                          const isDisabled = await btn.evaluate((el) => el.disabled || el.hasAttribute('disabled'));
                          if (!isDisabled) {
                            await btn.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
                            await new Promise((r) => setTimeout(r, 200));
                            await btn.click({ timeout: 2000 });
                            insertClicked = true;
                            break;
                          }
                        }
                      }
                    } catch (e) {
                      logger.debug({ err: e }, 'notebooklm: button search by text failed');
                    }
                    
                    // Priority 2: Find button in form containing textarea
                    if (!insertClicked) {
                      try {
                        const form = await page.$('form');
                        if (form) {
                          const insertButton = await form.$('button[type="submit"]');
                          if (insertButton) {
                            const isDisabled = await insertButton.evaluate((el) => el.disabled || el.hasAttribute('disabled'));
                            if (!isDisabled) {
                              await insertButton.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
                              await new Promise((r) => setTimeout(r, 200));
                              await insertButton.click({ timeout: 2000 });
                              insertClicked = true;
                            }
                          }
                        }
                      } catch (e) {
                        logger.debug({ err: e }, 'notebooklm: form selector failed');
                      }
                    }
                    
                    // Priority 3: Find by text "Insert" using evaluate
                    if (!insertClicked) {
                      const insertByText = await page.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
                        for (const btn of buttons) {
                          const text = (btn.textContent || '').trim();
                          if ((text === 'Insert' || text.includes('Insert')) && !btn.disabled && !btn.hasAttribute('disabled')) {
                            btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            btn.click();
                            return true;
                          }
                        }
                        return false;
                      });
                      if (insertByText) {
                        insertClicked = true;
                      }
                    }
                    
                    if (insertClicked) {
                      await new Promise((r) => setTimeout(r, 1000));
                    } else {
                      logger.warn({}, 'notebooklm: Insert button not found, text content entered but not submitted');
                    }
                  } else {
                    logger.warn({}, 'notebooklm: input #mat-input-2 not found');
                  }
                } else {
                  logger.warn({}, 'notebooklm: Copied text chip not found');
                }
            } catch (e) {
              logger.warn({ err: e }, 'notebooklm: error adding text content source');
            }
          }
          
          // Enter prompt after all sources are added
          if (prompt) {
            await logService.logInfo(entityType, entityID, userID, 'notebooklm_step', 
              'Đang nhập prompt vào query box', {});
            try {
              
              // Wait a bit for any modals to close
              await new Promise((r) => setTimeout(r, 1000));
              
              // Find prompt textarea by aria-label="Query box"
              let promptTextarea = await page.$('textarea[aria-label="Query box"]');
              if (!promptTextarea) {
                // Fallback: find by placeholder "Start typing..."
                promptTextarea = await page.$('textarea[placeholder*="Start typing"], textarea[placeholder*="Start"]');
              }
              if (!promptTextarea) {
                // Fallback: find by class query-box-input
                promptTextarea = await page.$('textarea.query-box-input');
              }
              if (!promptTextarea) {
                // Fallback: find by placeholder using evaluate
                promptTextarea = await page.evaluateHandle(() => {
                  const textareas = Array.from(document.querySelectorAll('textarea'));
                  for (const ta of textareas) {
                    const placeholder = (ta.getAttribute('placeholder') || '').toLowerCase();
                    const ariaLabel = (ta.getAttribute('aria-label') || '').toLowerCase();
                    if (placeholder.includes('start typing') || ariaLabel.includes('query box')) {
                      return ta;
                    }
                  }
                  return null;
                });
                if (promptTextarea && promptTextarea.asElement()) {
                  promptTextarea = promptTextarea.asElement();
                } else {
                  promptTextarea = null;
                }
              }
              
              if (promptTextarea) {
                // Scroll into view
                await promptTextarea.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
                await new Promise((r) => setTimeout(r, 300));
                
                // Focus and click
                await promptTextarea.focus();
                await promptTextarea.click({ timeout: 2000 });
                await new Promise((r) => setTimeout(r, 200));
                
                // Clear existing text and type prompt
                await promptTextarea.evaluate((el) => {
                  el.value = '';
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                });
                await promptTextarea.type(prompt, { delay: 10 });
                await new Promise((r) => setTimeout(r, 500));
                
                
                // Wait for Submit button to be enabled (button is disabled until text is entered)
                await page.waitForFunction(
                  () => {
                    const buttons = Array.from(document.querySelectorAll('button[type="submit"], button[aria-label="Submit"]'));
                    for (const btn of buttons) {
                      const ariaLabel = (btn.getAttribute('aria-label') || '').trim();
                      if (ariaLabel === 'Submit' || ariaLabel === 'Enter') {
                        return !btn.disabled && !btn.hasAttribute('disabled');
                      }
                    }
                    return false;
                  },
                  { timeout: 5000 }
                ).catch(() => {
                  logger.debug({}, 'notebooklm: Submit button not enabled within timeout');
                });
                
                await new Promise((r) => setTimeout(r, 300));
                
                // Set up CDP to wait for response to finish generating (if outputFile is provided)
                let responseFinishedPromise = null;
                let cdpSession = null;
                
                if (outputFile) {
                  
                  responseFinishedPromise = new Promise((resolve) => {
                    const client = page._client();
                    cdpSession = client;
                    
                    // Enable Network domain
                    client.send('Network.enable').catch(() => {});
                    
                    let targetRequestId = null;
                    
                    // Track the request
                    client.on('Network.responseReceived', (event) => {
                      const { response } = event;
                      if (response.url.includes('GenerateFreeFormStreamed') && response.status === 200) {
                        targetRequestId = event.requestId;
                      }
                    });
                    
                    // Wait for loading finished (indicates response is complete)
                    client.on('Network.loadingFinished', (event) => {
                      if (event.requestId === targetRequestId && targetRequestId) {
                        // Just resolve to indicate response is finished, don't get body
                        resolve(true);
                      }
                    });
                  });
                }
                
                // Click Submit button after entering prompt
                try {
                  await logService.logInfo(entityType, entityID, userID, 'notebooklm_step', 
                    'Đã nhập prompt, đang click Submit để generate outline', {});
                  
                  // Find button by type="submit" and aria-label="Submit"
                  let submitButton = await page.$('button[type="submit"][aria-label="Submit"]');
                  if (!submitButton) {
                    // Fallback: Find button by type="submit" only
                    submitButton = await page.$('button[type="submit"]');
                  }
                  if (!submitButton) {
                    // Fallback: Find button by aria-label="Submit" only
                    submitButton = await page.$('button[aria-label="Submit"]');
                  }
                  
                  if (submitButton) {
                    const isDisabled = await submitButton.evaluate((el) => el.disabled || el.hasAttribute('disabled'));
                    if (!isDisabled) {
                      await submitButton.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
                      await new Promise((r) => setTimeout(r, 200));
                      await submitButton.click({ timeout: 2000 });
                    } else {
                      logger.warn({}, 'notebooklm: Submit button found but still disabled');
                    }
                  } else {
                    logger.warn({}, 'notebooklm: Submit button not found');
                  }
                } catch (e) {
                  logger.warn({ err: e }, 'notebooklm: error clicking Submit button');
                }
                
                // Wait for response to finish generating, then scroll down and click copy button
                if (outputFile && responseFinishedPromise) {
                  try {
                    await logService.logInfo(entityType, entityID, userID, 'notebooklm_step', 
                      'Đang chờ NotebookLM generate outline', {});
                    
                    // Wait for Network.loadingFinished event (indicates response is complete)
                    await Promise.race([
                      responseFinishedPromise,
                      new Promise((resolve) => setTimeout(() => {
                        logger.warn({}, 'notebooklm: timeout waiting for response to finish');
                        resolve(false);
                      }, 120000))
                    ]);
                    
                    // Clean up CDP
                    if (cdpSession) {
                      try {
                        await cdpSession.send('Network.disable').catch(() => {});
                      } catch (e) {
                        // Ignore cleanup errors
                      }
                    }
                    
                    // Wait a bit more for response to fully render in DOM
                    await new Promise((r) => setTimeout(r, 2000));
                    
                    // Scroll down gradually to ensure copy button is visible
                    // Scroll multiple times to handle lazy loading content
                    for (let scrollAttempt = 0; scrollAttempt < 5; scrollAttempt++) {
                      await page.evaluate(() => {
                        window.scrollBy(0, window.innerHeight * 0.8);
                      });
                      await new Promise((r) => setTimeout(r, 500));
                    }
                    
                    // Final scroll to absolute bottom
                    await page.evaluate(() => {
                      window.scrollTo(0, document.body.scrollHeight);
                    });
                    await new Promise((r) => setTimeout(r, 1000));
                    
                    // Find copy button - specifically the "Copy model response" button, not summary copy button
                    let copyButton = null;
                    
                    // Priority 1: Try exact English aria-label
                    copyButton = await page.$('button[aria-label="Copy model response to clipboard"]');
                    
                    // Priority 2: Try Vietnamese aria-label with specific text "câu trả lời" (response)
                    if (!copyButton) {
                      copyButton = await page.$('button[aria-label*="Sao chép câu trả lời"], button[aria-label*="sao chép câu trả lời"]');
                    }
                    
                    // Priority 3: Try Vietnamese with "mô hình" (model) to distinguish from summary copy
                    if (!copyButton) {
                      copyButton = await page.$('button[aria-label*="mô hình"], button[aria-label*="Mô hình"]');
                    }
                    
                    // Priority 4: Search all buttons but filter for response copy button (not summary)
                    if (!copyButton) {
                      const buttonHandle = await page.evaluateHandle(() => {
                        const buttons = Array.from(document.querySelectorAll('button'));
                        for (const btn of buttons) {
                          const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
                          // Must contain copy-related text
                          const hasCopyText = ariaLabel.includes('copy') || ariaLabel.includes('sao chép') || 
                                             ariaLabel.includes('clipboard') || ariaLabel.includes('bảng nhớ');
                          // Must be response copy, not summary copy
                          const isResponseCopy = ariaLabel.includes('model response') || 
                                                ariaLabel.includes('câu trả lời') ||
                                                ariaLabel.includes('mô hình');
                          // Must NOT be summary copy
                          const isNotSummary = !ariaLabel.includes('tóm tắt') && 
                                              !ariaLabel.includes('summary') &&
                                              !ariaLabel.includes('nội dung tóm tắt');
                          
                          if (hasCopyText && (isResponseCopy || (isNotSummary && ariaLabel.includes('bảng nhớ')))) {
                            return btn;
                          }
                        }
                        return null;
                      });
                      if (buttonHandle && buttonHandle.asElement) {
                        copyButton = buttonHandle.asElement();
                      } else if (buttonHandle) {
                        copyButton = buttonHandle;
                      }
                    }
                    
                    // Priority 5: Try by class xap-copy-to-clipboard (specific to response copy)
                    if (!copyButton) {
                      copyButton = await page.$('button.xap-copy-to-clipboard');
                    }
                    
                    if (copyButton) {
                      // Scroll button into view
                      await copyButton.evaluate((el) => {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      });
                      await new Promise((r) => setTimeout(r, 1000));
                      
                      // Check if button is visible and enabled
                      const isVisible = await copyButton.evaluate((el) => {
                        const rect = el.getBoundingClientRect();
                        const style = window.getComputedStyle(el);
                        return rect.width > 0 && rect.height > 0 && 
                               style.visibility !== 'hidden' && 
                               style.display !== 'none' &&
                               !el.disabled;
                      });
                      
                      if (isVisible) {
                        await copyButton.click({ timeout: 3000 });
                      } else {
                        logger.warn({}, 'notebooklm: copy button found but not visible/enabled');
                      }
                      
                      // Wait a bit for clipboard to be updated
                      await new Promise((r) => setTimeout(r, 500));
                      
                      // Open anotepad.com in a new tab and paste text, then save to file
                      try {
                        
                        // Open new tab with anotepad.com
                        const anotepadPage = await browser.newPage();
                        await anotepadPage.goto('https://anotepad.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
                        
                        // Wait for editor to be ready
                        await new Promise((r) => setTimeout(r, 2000));
                        
                        // Find the textarea/editor element using evaluate
                        const editorFound = await anotepadPage.evaluate(() => {
                          // Priority 1: Try anotepad.com specific selectors
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
                            // Scroll into view
                            editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            // Focus
                            editor.focus();
                            // Clear existing content
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
                        
                        if (editorFound) {
                          // Wait a bit for focus
                          await new Promise((r) => setTimeout(r, 500));
                          
                          // Select all existing text (Ctrl+A) to replace it
                          await anotepadPage.keyboard.down('Control');
                          await anotepadPage.keyboard.press('a');
                          await anotepadPage.keyboard.up('Control');
                          await new Promise((r) => setTimeout(r, 200));
                          
                          // Paste using keyboard shortcut (will replace selected text)
                          await anotepadPage.keyboard.down('Control');
                          await anotepadPage.keyboard.press('v');
                          await anotepadPage.keyboard.up('Control');
                          
                          // Wait for paste to complete (longer wait to ensure paste is done)
                          await new Promise((r) => setTimeout(r, 2000));
                          
                          
                          // Extract text from editor (with multiple attempts and better selectors)
                          let pastedText = '';
                          try {
                            // Wait a bit more and try multiple times
                            for (let attempt = 0; attempt < 3; attempt++) {
                              await new Promise((r) => setTimeout(r, 500));
                              
                              pastedText = await anotepadPage.evaluate(() => {
                                // Priority 1: Try anotepad.com specific selectors
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
                                
                                // Fallback: Try contenteditable div
                                const contentEditable = document.querySelector('[contenteditable="true"]');
                                if (contentEditable) {
                                  const text = contentEditable.textContent || contentEditable.innerText || contentEditable.value || '';
                                  if (text && text.trim().length > 0) {
                                    return text;
                                  }
                                }
                                
                                return '';
                              });
                              
                              if (pastedText && pastedText.length > 0) {
                                break;
                              }
                            }
                            
                          } catch (extractErr) {
                            logger.warn({ err: extractErr }, 'notebooklm: error extracting text from anotepad');
                          }
                          
                          // Save to file (outputFile path is already set to profile folder by caller)
                          if (pastedText && pastedText.length > 0) {
                            const outputPath = path.resolve(outputFile);
                            const outputDir = path.dirname(outputPath);
                            
                            if (!fs.existsSync(outputDir)) {
                              fs.mkdirSync(outputDir, { recursive: true });
                            }
                            
                            fs.writeFileSync(outputPath, pastedText, 'utf8');
                            await logService.logSuccess(entityType, entityID, userID, 'notebooklm_step', 
                              `Đã lưu outline vào file: ${path.basename(outputFile)}`, {
                              file_path: outputFile,
                              content_length: pastedText.length
                            });
                          } else {
                            logger.warn({}, 'notebooklm: no text extracted from anotepad, file not saved');
                          }
                          
                          // Close anotepad tab
                          await anotepadPage.close();
                        } else {
                          logger.warn({}, 'notebooklm: editor not found on anotepad.com');
                          await anotepadPage.close();
                        }
                      } catch (anotepadErr) {
                        logger.error({ err: anotepadErr, stack: anotepadErr.stack }, 'notebooklm: error using anotepad.com');
                      }
                    } else {
                      logger.warn({}, 'notebooklm: copy button not found');
                    }
                  } catch (e) {
                    logger.error({ err: e, stack: e.stack }, 'notebooklm: error waiting for response or clicking copy button');
                    // Clean up on error
                    if (cdpSession) {
                      try {
                        await cdpSession.send('Network.disable').catch(() => {});
                      } catch (e) {
                        // Ignore cleanup errors
                      }
                    }
                  }
                }
              } else {
                logger.warn({}, 'notebooklm: prompt textarea not found');
              }
            } catch (e) {
              logger.warn({ err: e }, 'notebooklm: error entering prompt');
            }
          }
          } catch (sourceError) {
            logger.warn({ err: sourceError }, 'notebooklm: error adding sources, continuing');
          }
        }
      } else {
        logger.warn({}, 'notebooklm: Create new notebook button not found or not clickable');
        status = 'launched';
      }
    } catch (createError) {
      logger.warn({ err: createError }, 'notebooklm: error clicking Create new notebook, continuing');
      status = 'launched';
    }

    return { status, url: page.url() };
  } catch (e) {
    if (logger && logger.error) logger.error({ err: e }, 'notebooklm: failed');
    await logService.logError(entityType, entityID, userID, 'notebooklm_step', 
      `Lỗi khi chạy NotebookLM: ${e?.message || String(e)}`, {
      error: e?.message || String(e)
    });
    return { status: 'failed', error: e?.message || String(e) };
  } finally {
    try { browser.disconnect(); } catch (_) {}
  }
}

module.exports = { launchNotebookLM };


