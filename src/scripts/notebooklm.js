const { logger } = require('../logger');
const { connectToBrowserByUserDataDir } = require('./gmailLogin');
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
async function launchNotebookLM({ userDataDir, debugPort, website, youtube, textContent, prompt, outputFile }) {
  const { browser } = await connectToBrowserByUserDataDir(userDataDir, debugPort);
  let status = 'unknown';
  try {
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
    const url = 'https://notebooklm.google.com/';
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    const host = (() => { try { return new URL(page.url()).hostname; } catch { return ''; } })();
    if (host.includes('accounts.google.com')) {
      status = 'not_logged_in';
      return { status, url: page.url() };
    }

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

      if (createClicked) {
        await new Promise((r) => setTimeout(r, 2000));
        status = 'notebook_created';
        
        // Add sources if provided
        if (website || youtube || textContent) {
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
            if (website && Array.isArray(website) && website.length > 0) {
              try {
                
                // Priority 1: Try to find by ID
                let websiteChip = await page.$('mat-chip#mat-mdc-chip-1');
                
                // Priority 2: Try to find mat-chip containing "Website" text
                if (!websiteChip) {
                  websiteChip = await page.evaluateHandle(() => {
                    const chips = Array.from(document.querySelectorAll('mat-chip'));
                    for (const chip of chips) {
                      const text = (chip.textContent || '').trim();
                      if (text === 'Website' || text.includes('Website')) {
                        return chip;
                      }
                    }
                    return null;
                  });
                  if (websiteChip && websiteChip.asElement()) {
                    websiteChip = websiteChip.asElement();
                  } else {
                    websiteChip = null;
                  }
                }
                
                // Priority 3: Try to find by class containing chip
                if (!websiteChip) {
                  const chips = await page.$$('mat-chip, [class*="chip"]');
                  for (const chip of chips) {
                    const text = await chip.evaluate((el) => (el.textContent || '').trim());
                    if (text === 'Website' || text.includes('Website')) {
                      websiteChip = chip;
                      break;
                    }
                  }
                }
                
                if (websiteChip) {
                  // Scroll into view and click
                  await websiteChip.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
                  await new Promise((r) => setTimeout(r, 300));
                  await websiteChip.click({ timeout: 2000 });
                  
                  await new Promise((r) => setTimeout(r, 1500));
                  
                  // Find textarea/input with formcontrolname="newUrl"
                  const urlTextarea = await page.$('textarea[formcontrolname="newUrl"], input[formcontrolname="newUrl"], textarea#mat-input-1, input#mat-input-1');
                  if (urlTextarea) {
                    await urlTextarea.click();
                    // Join URLs with newline (one URL per line)
                    const urlsText = website.join('\n');
                    await urlTextarea.type(urlsText, { delay: 50 });
                    await new Promise((r) => setTimeout(r, 500));
                    
                    // Click Insert button
                    let insertClicked = false;
                    
                    // Priority 1: Find button in website-upload form using xpath
                    try {
                      const insertButtonXpath = await page.$x('//*[@id="mat-mdc-dialog-2"]/div/div/upload-dialog/div/div[2]/website-upload/form/button');
                      if (insertButtonXpath && insertButtonXpath.length > 0) {
                        await insertButtonXpath[0].click({ timeout: 2000 });
                        insertClicked = true;
                      }
                    } catch (e) {
                      logger.debug({ err: e }, 'notebooklm: xpath selector failed');
                    }
                    
                    // Priority 2: Find button in website-upload form
                    if (!insertClicked) {
                      try {
                        const websiteUploadForm = await page.$('website-upload form, upload-dialog website-upload form');
                        if (websiteUploadForm) {
                          const insertButton = await websiteUploadForm.$('button[type="submit"], button.submit-button, button');
                          if (insertButton) {
                            await insertButton.click({ timeout: 2000 });
                            insertClicked = true;
                          }
                        }
                      } catch (e) {
                        logger.debug({ err: e }, 'notebooklm: form selector failed');
                      }
                    }
                    
                    // Priority 3: Find by class submit-button
                    if (!insertClicked) {
                      const insertButton = await page.$('button.submit-button, button[type="submit"].submit-button');
                      if (insertButton) {
                        await insertButton.click({ timeout: 2000 });
                        insertClicked = true;
                      }
                    }
                    
                    // Priority 4: Find by text "Insert"
                    if (!insertClicked) {
                      const insertByText = await page.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
                        for (const btn of buttons) {
                          const text = (btn.textContent || '').trim();
                          if (text === 'Insert' || text.includes('Insert')) {
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
                      logger.warn({}, 'notebooklm: Insert button not found, URLs entered but not submitted');
                    }
                  } else {
                    logger.warn({}, 'notebooklm: textarea #mat-input-1 not found');
                  }
                } else {
                  logger.warn({}, 'notebooklm: Website chip not found');
                }
              } catch (e) {
                // Ignore error adding website source
              }
            }
            
            // Add YouTube source (insert one by one)
            if (youtube && Array.isArray(youtube) && youtube.length > 0) {
              try {
                
                for (let i = 0; i < youtube.length; i += 1) {
                  const youtubeUrl = youtube[i];
                  try {
                    
                    // Click "Add source" button only if modal is not open
                    const modalOpen = await isModalOpen();
                    if (!modalOpen) {
                      const addSourceButton = await page.$('button[aria-label="Add source"], [aria-label="Add source"]');
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
                    
                    // Find YouTube chip by text "YouTube"
                    let youtubeChip = null;
                    const allChips = await page.$$('mat-chip');
                    for (const chip of allChips) {
                      const text = await chip.evaluate((el) => (el.textContent || '').trim());
                      if (text === 'YouTube' || text.includes('YouTube')) {
                        youtubeChip = chip;
                        break;
                      }
                    }
                    
                    if (youtubeChip) {
                      // Scroll into view and click
                      await youtubeChip.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
                      await new Promise((r) => setTimeout(r, 300));
                      await youtubeChip.click({ timeout: 2000 });
                      
                      await new Promise((r) => setTimeout(r, 1500));
                      
                      // Find input with formcontrolname="newUrl"
                      const urlInput = await page.$('input[formcontrolname="newUrl"], textarea[formcontrolname="newUrl"], input#mat-input-5, textarea#mat-input-5');
                      if (urlInput) {
                        await urlInput.click();
                        await urlInput.type(youtubeUrl, { delay: 50 });
                        await new Promise((r) => setTimeout(r, 500));
                        
                        // Click Insert button
                        let insertClicked = false;
                        
                        // Priority 1: Find button in youtube-upload form using xpath
                        try {
                          const insertButtonXpath = await page.$x('//*[@id="mat-mdc-dialog-2"]/div/div/upload-dialog/div/div[2]/youtube-upload/form/button');
                          if (insertButtonXpath && insertButtonXpath.length > 0) {
                            await insertButtonXpath[0].click({ timeout: 2000 });
                            insertClicked = true;
                          }
                        } catch (e) {
                          logger.debug({ err: e }, 'notebooklm: xpath selector failed');
                        }
                        
                        // Priority 2: Find button in youtube-upload form
                        if (!insertClicked) {
                          try {
                            const youtubeUploadForm = await page.$('youtube-upload form, upload-dialog youtube-upload form');
                            if (youtubeUploadForm) {
                              const insertButton = await youtubeUploadForm.$('button[type="submit"], button.submit-button, button');
                              if (insertButton) {
                                await insertButton.click({ timeout: 2000 });
                                insertClicked = true;
                              }
                            }
                          } catch (e) {
                            logger.debug({ err: e }, 'notebooklm: form selector failed');
                          }
                        }
                        
                        // Priority 3: Find by class submit-button
                        if (!insertClicked) {
                          const insertButton = await page.$('button.submit-button, button[type="submit"].submit-button');
                          if (insertButton) {
                            await insertButton.click({ timeout: 2000 });
                            insertClicked = true;
                          }
                        }
                        
                        // Priority 4: Find by text "Insert"
                        if (!insertClicked) {
                          const insertByText = await page.evaluate(() => {
                            const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
                            for (const btn of buttons) {
                              const text = (btn.textContent || '').trim();
                              if (text === 'Insert' || text.includes('Insert')) {
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
                          await new Promise((r) => setTimeout(r, 1500));
                        } else {
                          logger.warn({ url: youtubeUrl }, 'notebooklm: Insert button not found, YouTube URL entered but not submitted');
                        }
                      } else {
                        logger.warn({ url: youtubeUrl }, 'notebooklm: input not found for YouTube URL');
                      }
                    } else {
                      logger.warn({ url: youtubeUrl }, 'notebooklm: YouTube chip not found');
                    }
                  } catch (urlError) {
                    logger.warn({ err: urlError, url: youtubeUrl, index: i + 1 }, 'notebooklm: error processing YouTube URL, continuing to next');
                  }
                }
                
              } catch (e) {
                logger.warn({ err: e }, 'notebooklm: error adding YouTube sources');
              }
            }
            // Add text content source
            if (textContent) {
              try {
                
                // Click "Add source" button only if modal is not open
                const modalOpen = await isModalOpen();
                if (!modalOpen) {
                  const addSourceButton = await page.$('button[aria-label="Add source"], [aria-label="Add source"]');
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
                    
                    // Scroll to bottom to ensure all content is loaded
                    await page.evaluate(() => {
                      window.scrollTo(0, document.body.scrollHeight);
                    });
                    await new Promise((r) => setTimeout(r, 1000));
                    
                    // Find and click the copy button
                    const copyButton = await page.$('button[aria-label="Copy model response to clipboard"]');
                    if (copyButton) {
                      await copyButton.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
                      await new Promise((r) => setTimeout(r, 500));
                      await copyButton.click({ timeout: 2000 });
                      
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
    return { status: 'failed', error: e?.message || String(e) };
  } finally {
    try { browser.disconnect(); } catch (_) {}
  }
}

module.exports = { launchNotebookLM };


