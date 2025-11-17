const { connectToBrowserByUserDataDir } = require('./gmailLogin');

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
    
    // Step 2: Click button to trigger Gemini to create input (but no OS dialog will open)
    // Find and click upload button - CHỈ tìm button có aria-label="Open upload file menu"
    const buttonFound = await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label="Open upload file menu"]');
      if (btn && btn.offsetParent !== null) {
        btn.click();
        return true;
      }
      return false;
    });
    
    if (!buttonFound) {
      // Fallback: try clickSelectors
      const clickedPlus = await clickSelectors(page, [
        'button[aria-label="Open upload file menu"]',
      ], { timeoutMs: 5000 }).catch(() => false);
      
      if (!clickedPlus) {
        // Restore click method
        await page.evaluate(() => {
          if (window.__puppeteer_patched_input_click) {
            HTMLInputElement.prototype.click = window.__puppeteer_patched_input_click;
            delete window.__puppeteer_patched_input_click;
          }
        });
        return false;
      }
    }
    
    // Wait for menu to appear
    await new Promise((r) => setTimeout(r, 300));
    
    // Click "Upload files" menu item
    const menuItemClicked = await page.evaluate(() => {
      const menuItems = [
        'button[data-test-id="local-images-files-uploader-button"]',
        'button[aria-label="Upload files"]',
      ];
      
      for (const sel of menuItems) {
        const item = document.querySelector(sel);
        if (item) {
          item.click();
          return { clicked: true, selector: sel };
        }
      }
      return { clicked: false };
    });
    
    if (!menuItemClicked.clicked) {
      const clickedMenuItem = await clickSelectors(page, [
        'button[data-test-id="local-images-files-uploader-button"]',
        'button[aria-label="Upload files"]',
      ], { timeoutMs: 1500 }).catch(() => {});
      
      if (!clickedMenuItem) {
        // Restore click method
        await page.evaluate(() => {
          if (window.__puppeteer_patched_input_click) {
            HTMLInputElement.prototype.click = window.__puppeteer_patched_input_click;
            delete window.__puppeteer_patched_input_click;
          }
        });
        return false;
      }
    }
    
    // Wait for input to be created (Gemini will try to click it, but our patch prevents OS dialog)
    await new Promise((r) => setTimeout(r, 500));
    
    // Step 3: Find the input that Gemini created (should be in DOM now, no OS dialog opened)
    const fileInputSelectors = [
      '#cdk-overlay-1 > mat-card > mat-action-list > images-files-uploader > input[type=file]',
      'div.editor-container.hide-on-mobile-preview input[type="file"]',
      'div.editor-container-inner input[type="file"]',
      'div.knowledge-files-content input[type="file"]',
      'images-files-uploader input[type="file"]',
      'input[type="file"][name="Filedata"]',
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
        
        // Step 6: Restore original click method
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
    
    // Fallback: try to locate hidden input and set files directly (may not always be present)
    // Restore click method first
    await page.evaluate(() => {
      if (window.__puppeteer_patched_input_click) {
        HTMLInputElement.prototype.click = window.__puppeteer_patched_input_click;
        delete window.__puppeteer_patched_input_click;
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
    if (input) {
      try {
        if (input.uploadFile) {
          await input.uploadFile(...existing);
        } else if (page.setInputFiles) {
          await page.setInputFiles(input, existing);
        }
        return true;
      } catch (e) {
        // ignore
      }
    }
  } catch (e) {
    // Restore original click method on error
    await page.evaluate(() => {
      if (window.__puppeteer_patched_input_click) {
        HTMLInputElement.prototype.click = window.__puppeteer_patched_input_click;
        delete window.__puppeteer_patched_input_click;
      }
    });
  }
  
  return false;
}

async function createGem({ userDataDir, name, description, instructions, knowledgeFiles, debugPort }) {
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


    // Click Explore Gems in the sidebar (prefer aria-label selector to avoid accidental matches)
    const clickedExplore = await clickSelectors(page, [
      'button[aria-label="Explore Gems"]',
      'button[aria-label*="Explore Gems" i]',
      '[aria-label="Explore Gems"]',
    ], { timeoutMs: 12000 }) || await clickByText(page, ['Explore Gems', 'Khám phá Gems'], { timeoutMs: 8000 });
    await Promise.race([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
      new Promise((r) => setTimeout(r, 1200)),
    ]);

    // Try click New Gem button inside Gem manager
    let clickedNew = false;
    if (clickedExplore) {
      clickedNew = await clickSelectors(page, [
        '[data-test-id="open-bots-creation-button"]',
        'button[data-test-id*="open-bots-creation"]',
        'button[data-test-id*="creation"]',
        'button.mat-mdc-button-base.bot-creation-button',
      ], { timeoutMs: 8000 });
      if (!clickedNew) {
        clickedNew = await clickByText(page, ['New Gem', 'Create new Gem', 'Create a Gem', 'Tạo Gem', 'Tạo mới'], { timeoutMs: 6000 });
      }
      if (clickedNew) {
        await Promise.race([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
          new Promise((r) => setTimeout(r, 800)),
        ]);
        // Dismiss onboarding tooltips/modals if they appear
        await dismissOnboarding(page, { rounds: 6 });

        // Fill fields if provided
        if (name) {
          // Prefer stable id if present
          let nameField = await page.$('#gem-name-input');
          if (!nameField) nameField = await findFieldByPlaceholders(page, ['Give your Gem a name', 'Name']);
          if (!nameField) nameField = await findFieldByLabel(page, ['Name']);
          if (nameField) await typeInto(page, nameField, name);
        }
        if (description) {
          let descField = await findFieldByPlaceholders(page, ['Describe your Gem', 'Description']);
          if (!descField) descField = await findFieldByLabel(page, ['Description']);
          if (descField) await typeInto(page, descField, description);
        }
        if (instructions) {
          // Prefer explicit instruction rich editor container
          let instField = await page.$('[data-test-id="instruction-rich-input-field"], div[role="textbox"][data-test-id*="instruction"]');
          if (!instField) instField = await findFieldByPlaceholders(page, ['Instructions']);
          if (!instField) instField = await findFieldByLabel(page, ['Instructions']);
          if (instField) {
            // Check if contenteditable
            const isEditable = await instField.evaluate((el) => el.isContentEditable === true || el.getAttribute('contenteditable') === 'true');
            if (isEditable) {
              await typeIntoEditable(page, instField, instructions);
            } else {
              await typeInto(page, instField, instructions);
            }
          }
        }
        if (knowledgeFiles && knowledgeFiles.length) {
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
						await clickSelectors(page, candidates, { timeoutMs: 5000 })
							|| await clickByText(page, ['Save', 'Lưu'], { timeoutMs: 5000 });
					}
        }
      }
    }

    status = clickedNew ? 'new_gem_clicked' : (clickedExplore ? 'opened_explore' : 'noop');
    return { status };
  } catch (e) {
    return { status: 'failed', error: e?.message || String(e) };
  } finally {
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


