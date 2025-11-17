const { connectToBrowserByUserDataDir } = require('./gmailLogin');
const { clickByText, clickSelectors, uploadKnowledgeFiles } = require('./gemini');
const fs = require('fs');
const path = require('path');

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
    
    // Step 2: Click button to trigger Gemini to create input (but no OS dialog will open)
    // Find and click upload button
    const buttonFound = await page.evaluate(() => {
      const selectors = [
        'button[aria-label="Open upload file menu"]',
        'button[aria-label*="upload" i]',
        'button[aria-label*="file" i]',
      ];
      
      for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn && btn.offsetParent !== null) {
          btn.click();
          return true;
        }
      }
      return false;
    });
    
    if (!buttonFound) {
      return false;
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
    
    // Fallback to original method if patch method failed
    // Method: Create fake input, upload files, then trigger Gemini's upload logic
    const uploadResult = await page.evaluate(async (filePaths) => {
      // Step 1: Create a fake input element
      const fakeInput = document.createElement('input');
      fakeInput.type = 'file';
      fakeInput.multiple = true;
      fakeInput.style.display = 'none';
      fakeInput.id = 'puppeteer-fake-file-input-' + Date.now();
      document.body.appendChild(fakeInput);
      
      // Step 2: Try to find Gemini's upload handler/component
      // Look for Angular component or upload handler
      const findUploadHandler = () => {
        // Try to find images-files-uploader component
        const uploader = document.querySelector('images-files-uploader');
        if (uploader) {
          // Try to access Angular component instance
          const ngComponent = uploader.__ngContext__ || uploader._ngContentHost;
          if (ngComponent) {
            return { type: 'component', element: uploader, instance: ngComponent };
          }
        }
        
        // Try to find input area container
        const inputArea = document.querySelector('div.input-area-container, div[file-drop-zone]');
        if (inputArea) {
          return { type: 'container', element: inputArea };
        }
        
        return null;
      };
      
      const handler = findUploadHandler();
      
      return {
        fakeInputId: fakeInput.id,
        handlerFound: !!handler,
        handlerType: handler?.type || null
      };
    }, existing);
    
    if (!uploadResult.handlerFound) {
      // Handler not found, continue with alternative method
    }
    
    // Step 3: Upload files to fake input using Puppeteer (no OS dialog)
    const fakeInputHandle = await page.$(`#${uploadResult.fakeInputId}`);
    if (!fakeInputHandle) {
      throw new Error('Fake input not found');
    }
    
    await fakeInputHandle.uploadFile(...existing);
    
    // Step 4: Transfer files from fake input to Gemini's logic
    // First, try to trigger Gemini's input to appear by clicking button
    // Click button to open menu and trigger input creation
    const buttonClicked = await page.evaluate(() => {
      const selectors = [
        'button[aria-label="Open upload file menu"]',
        'button[aria-label*="upload" i]',
      ];
      
      for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn && btn.offsetParent !== null) {
          btn.click();
          return true;
        }
      }
      return false;
    });
    
    if (buttonClicked) {
      await new Promise((r) => setTimeout(r, 300));
      
      // Click "Upload files" menu item
      await page.evaluate(() => {
        const menuItems = [
          'button[data-test-id="local-images-files-uploader-button"]',
          'button[aria-label="Upload files"]',
        ];
        
        for (const sel of menuItems) {
          const item = document.querySelector(sel);
          if (item) {
            item.click();
            return true;
          }
        }
        return false;
      });
      
      await new Promise((r) => setTimeout(r, 500));
    }
    
    const transferResult = await page.evaluate(async (fakeInputId, handlerType) => {
      const fakeInput = document.getElementById(fakeInputId);
      if (!fakeInput || !fakeInput.files || fakeInput.files.length === 0) {
        return { success: false, error: 'No files in fake input' };
      }
      
      const files = Array.from(fakeInput.files);
      
      // Method 1: Try to find Gemini's input (should be visible now after clicking)
      const geminiInputs = [
        '#cdk-overlay-1 > mat-card > mat-action-list > images-files-uploader > input[type=file]',
        'input[type="file"][name="Filedata"]',
        'images-files-uploader input[type="file"]',
        'input[type="file"][multiple]',
        'input[type="file"]'
      ];
      
      let geminiInput = null;
      for (const sel of geminiInputs) {
        geminiInput = document.querySelector(sel);
        if (geminiInput) {
          // Verify it's actually in the DOM and accessible
          try {
            const rect = geminiInput.getBoundingClientRect();
            if (rect || geminiInput.offsetParent !== null || window.getComputedStyle(geminiInput).display !== 'none') {
              break;
            }
          } catch (e) {
            // Continue to next selector
            geminiInput = null;
          }
        }
      }
      
      if (geminiInput) {
        // Method 1a: Return input selector so we can use Puppeteer uploadFile on it
        // This will be handled outside evaluate
        return { 
          success: false, 
          method: 'needs-puppeteer-upload', 
          inputSelector: geminiInput.id ? `#${geminiInput.id}` : 
                        (geminiInput.name ? `input[name="${geminiInput.name}"]` : null),
          inputFound: true,
          fileCount: files.length
        };
      }
      
      // Method 2: Try to find and call Gemini's upload function directly via Angular component
      const uploader = document.querySelector('images-files-uploader');
      if (uploader) {
        try {
          // Try to access component instance via Angular's __ngContext__
          const ngContext = uploader.__ngContext__;
          if (ngContext && ngContext.length > 0) {
            // Look for component instance in ngContext
            for (let i = 0; i < ngContext.length; i++) {
              const item = ngContext[i];
              if (item && typeof item === 'object') {
                // Try common upload method names
                const methods = ['handleFiles', 'onFilesSelected', 'uploadFiles', 'onFileChange', 'handleFileInput'];
                for (const methodName of methods) {
                  if (typeof item[methodName] === 'function') {
                    try {
                      // Try calling with files array
                      item[methodName](files);
                      return { success: true, method: `component-${methodName}`, fileCount: files.length };
                    } catch (e) {
                      // Try with event-like object
                      try {
                        item[methodName]({ target: { files: files }, files: files });
                        return { success: true, method: `component-${methodName}-event`, fileCount: files.length };
                      } catch (e2) {
                        // Continue to next method
                      }
                    }
                  }
                }
                
                // Try to find input element inside component and trigger its change
                const componentInput = uploader.querySelector('input[type="file"]');
                if (componentInput) {
                  try {
                    const dataTransfer = new DataTransfer();
                    files.forEach(file => dataTransfer.items.add(file));
                    
                    // Try to set files
                    Object.defineProperty(componentInput, 'files', {
                      value: dataTransfer.files,
                      writable: true,
                      configurable: true
                    });
                    
                    componentInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                    return { success: true, method: 'component-input-change', fileCount: files.length };
                  } catch (e) {
                    // Continue
                  }
                }
              }
            }
          }
        } catch (e) {
          // Continue to next method
        }
      }
      
      // Method 3: Try to trigger Gemini's drop handler with DataTransfer (using real File objects)
      const dropZone = document.querySelector('div[file-drop-zone="!inGemsMode"]') ||
                       document.querySelector('div.xapfileselectordropzone') ||
                       document.querySelector('div.input-area-container');
      
      if (dropZone) {
        try {
          const dataTransfer = new DataTransfer();
          files.forEach(file => dataTransfer.items.add(file));
          
          // Set effectAllowed and dropEffect
          dataTransfer.effectAllowed = 'all';
          dataTransfer.dropEffect = 'copy';
          
          // Create drag events with proper properties
          const dragEnterEvent = new DragEvent('dragenter', {
            bubbles: true,
            cancelable: true,
            dataTransfer: dataTransfer,
            clientX: 100,
            clientY: 100
          });
          
          const dragOverEvent = new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            dataTransfer: dataTransfer,
            clientX: 100,
            clientY: 100
          });
          
          const dropEvent = new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            dataTransfer: dataTransfer,
            clientX: 100,
            clientY: 100
          });
          
          dropZone.dispatchEvent(dragEnterEvent);
          dropZone.dispatchEvent(dragOverEvent);
          dropZone.dispatchEvent(dropEvent);
          
          return { success: true, method: 'drop-event', fileCount: files.length };
        } catch (e) {
          return { success: false, error: 'Drop event failed: ' + e.message };
        }
      }
      
      return { success: false, error: 'No method found to transfer files - no input, no component, no dropzone' };
    }, uploadResult.fakeInputId, uploadResult.handlerType);
    
    // Special case: If we found Gemini input, use Puppeteer uploadFile on it (with file chooser interception)
    if (transferResult.method === 'needs-puppeteer-upload' && transferResult.inputFound) {
      // Set up file chooser listener BEFORE calling uploadFile
      const fileChooserPromise = new Promise((resolve) => {
        page.once('filechooser', async (fileChooser) => {
          try {
            await fileChooser.accept(existing);
            resolve(true);
          } catch (err) {
            resolve(false);
          }
        });
      });
      
      // Find the input using selectors
      const geminiInputSelectors = [
        '#cdk-overlay-1 > mat-card > mat-action-list > images-files-uploader > input[type=file]',
        'input[type="file"][name="Filedata"]',
        'images-files-uploader input[type="file"]',
        'input[type="file"][multiple]',
        'input[type="file"]'
      ];
      
      let geminiInputHandle = null;
      for (const sel of geminiInputSelectors) {
        try {
          geminiInputHandle = await page.$(sel);
          if (geminiInputHandle) {
            break;
          }
        } catch (e) {
          // Continue
        }
      }
      
      if (geminiInputHandle) {
        try {
          // Call uploadFile - this will trigger file chooser, but we intercept it
          const uploadPromise = geminiInputHandle.uploadFile(...existing);
          
          // Race between file chooser interception and upload completion
          const result = await Promise.race([
            fileChooserPromise,
            uploadPromise.then(() => true),
            new Promise((resolve) => setTimeout(() => resolve(false), 3000))
          ]);
          
          if (result) {
            // Clean up fake input
            await page.evaluate((fakeInputId) => {
              const fakeInput = document.getElementById(fakeInputId);
              if (fakeInput) fakeInput.remove();
            }, uploadResult.fakeInputId);
            
            // Wait for upload to process
            await new Promise((r) => setTimeout(r, 2000));
            return true;
          }
        } catch (uploadError) {
          // Continue
        }
      }
    }
    
    if (transferResult.success) {
      // Clean up fake input
      await page.evaluate((fakeInputId) => {
        const fakeInput = document.getElementById(fakeInputId);
        if (fakeInput) fakeInput.remove();
      }, uploadResult.fakeInputId);
      
      // Wait for upload to process
      await new Promise((r) => setTimeout(r, 2000));
      return true;
    }
    
    // Fallback: Click button to open menu (original method)
    // Register filechooser BEFORE clicking (as fallback)
    const chooserPromiseFallback = new Promise((resolve) => {
      page.once('filechooser', resolve);
    });
    
    // Try to find button in page.evaluate first
    const buttonFoundFallback = await page.evaluate(() => {
      // Common selectors for upload button in chat interface
      const selectors = [
        'button[aria-label="Open upload file menu"]',
        'button[aria-label*="upload" i]',
        'button[aria-label*="file" i]',
        'button[data-test-id*="upload"]',
        'button[data-test-id*="file"]',
        'button[class*="upload"]',
        'button[class*="attach"]',
      ];
      
      // Try selectors first
      for (const sel of selectors) {
        try {
          const btn = document.querySelector(sel);
          if (btn && btn.offsetParent !== null) {
            const rect = btn.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              return { found: true, selector: sel, text: btn.textContent || btn.getAttribute('aria-label') || '' };
            }
          }
        } catch (e) {
          // Continue
        }
      }
      
      // Try to find button in input area container
      const inputArea = document.querySelector('div.input-area-container, div[file-drop-zone]');
      if (inputArea) {
        const buttons = inputArea.querySelectorAll('button');
        for (const btn of buttons) {
          if (btn.offsetParent !== null) {
            const rect = btn.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              // Check if button has SVG (plus icon) or specific aria-label
              const hasSvg = btn.querySelector('svg') !== null;
              const ariaLabel = btn.getAttribute('aria-label') || '';
              if (hasSvg || ariaLabel.toLowerCase().includes('upload') || ariaLabel.toLowerCase().includes('file') || ariaLabel.toLowerCase().includes('attach')) {
                return { found: true, selector: 'button in input-area', text: ariaLabel || 'button with icon' };
              }
            }
          }
        }
      }
      
      return { found: false };
    });
    
    if (!buttonFoundFallback.found) {
      return false;
    }
    
    // Click the button - if selector is generic, use page.evaluate to click directly
    let clickedFallback = false;
    if (buttonFoundFallback.selector === 'button in input-area') {
      // Click button directly in evaluate
      clickedFallback = await page.evaluate(() => {
        const inputArea = document.querySelector('div.input-area-container, div[file-drop-zone]');
        if (inputArea) {
          const buttons = inputArea.querySelectorAll('button');
          for (const btn of buttons) {
            if (btn.offsetParent !== null) {
              const rect = btn.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                const hasSvg = btn.querySelector('svg') !== null;
                const ariaLabel = btn.getAttribute('aria-label') || '';
                if (hasSvg || ariaLabel.toLowerCase().includes('upload') || ariaLabel.toLowerCase().includes('file') || ariaLabel.toLowerCase().includes('attach')) {
                  btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
                  btn.focus();
                  btn.click();
                  return true;
                }
              }
            }
          }
        }
        return false;
      });
    } else {
      // Use clickSelectors for specific selector
      clickedFallback = await clickSelectors(page, [buttonFoundFallback.selector], { timeoutMs: 2000 });
    }
    
    if (!clickedFallback) {
      return false;
    }
    
    // Wait a bit for menu to appear (if button opens a menu)
    await new Promise((r) => setTimeout(r, 300));
    
    // Check if a menu appeared and try to click "Upload files" item
    const uploadMenuItemClickedFallback = await clickSelectors(page, [
      'button[data-test-id="local-images-files-uploader-button"]',
      'button[aria-label="Upload files"]',
      'button[aria-label*="Upload" i]',
      'div[role="menu"] button',
      'div[role="menuitem"]',
    ], { timeoutMs: 1000 }).catch(() => false);
    
    // Step 2: After clicking "Upload files", input should appear in DOM
    // Wait a bit for input to be created
    await new Promise((r) => setTimeout(r, 300));
    
    // Step 3: Try to find the input that was just created (NO OS chooser)
    const fileInputSelectorsFallback = [
      '#cdk-overlay-1 > mat-card > mat-action-list > images-files-uploader > input[type=file]',
      'input[type="file"][name="Filedata"]',
      'images-files-uploader input[type="file"]',
      'input[type="file"][multiple]',
      'input[type="file"]',
    ];
    
    // Wait for input to appear (with timeout)
    let fileInputFallback = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      for (const selector of fileInputSelectorsFallback) {
        try {
          fileInputFallback = await page.$(selector);
          if (fileInputFallback) {
            // Use Puppeteer's uploadFile - this does NOT open OS chooser
            await fileInputFallback.uploadFile(...existing);
            
            // Wait a bit for upload to process
            await new Promise((r) => setTimeout(r, 1000));
            return true;
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      // If not found, wait a bit and try again
      if (!fileInputFallback) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    
    // Step 4: Fallback - if input not found, use file chooser
    const fileChooserFallback = await Promise.race([
      chooserPromiseFallback,
      new Promise((resolve, reject) => 
        setTimeout(() => reject(new Error('filechooser timeout')), 2000)
      ),
    ]).catch(() => {
      return null;
    });
    
    if (fileChooserFallback) {
      await fileChooserFallback.accept(existing);
      return true;
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
        try {
          // Scroll to bottom to ensure input area is visible
          await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
          });
          await new Promise((r) => setTimeout(r, 500));
          
          // Upload files via file chooser (click button to trigger file chooser)
          const uploaded = await uploadFilesViaFileChooser(page, filesExist);
          if (uploaded) {
            await new Promise((r) => setTimeout(r, 2000));
          } else {
            // Fallback: try uploadKnowledgeFiles (for Knowledge section)
            const uploaded2 = await uploadKnowledgeFiles(page, filesExist);
            if (uploaded2) {
              await new Promise((r) => setTimeout(r, 2000));
            }
          }
        } catch (e) {
          // Fallback to uploadKnowledgeFiles
          try {
            const uploaded = await uploadKnowledgeFiles(page, filesExist);
            if (uploaded) {
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
      // First, try to find rich-textarea element (Angular component)
      let promptField = null;
      const richTextarea = await page.$('rich-textarea');
      if (richTextarea) {
        // Find the contenteditable div inside rich-textarea (usually .ql-editor)
        promptField = await richTextarea.$('.ql-editor, [contenteditable="true"], div[role="textbox"]');
        if (promptField) {
          const entered = await typeIntoEditable(page, promptField, prompt);
          if (!entered) {
            promptField = null; // Try fallback
          }
        }
      }
      

      // Step 4: Set up CDP to intercept StreamGenerate request before submitting
      let responseFinishedPromise = null;
      let cdpSession = null;
      
      responseFinishedPromise = new Promise((resolve) => {
        const client = page._client();
        cdpSession = client;
        
        // Enable Network domain
        client.send('Network.enable').catch(() => {});
        
        let targetRequestId = null;
        
        // Track the StreamGenerate request
        client.on('Network.responseReceived', (event) => {
          const { response } = event;
          if (response.url.includes('StreamGenerate') && response.status === 200) {
            targetRequestId = event.requestId;
          }
        });
        
        // Wait for loading finished (indicates response is complete)
        client.on('Network.loadingFinished', (event) => {
          if (event.requestId === targetRequestId && targetRequestId) {
            resolve(true);
          }
        });
      });
      
      // Step 5: Submit the prompt (click send button or press Enter)
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

      // Step 6: Wait for StreamGenerate response to finish, then scroll and click copy-button
      if (responseFinishedPromise) {
        try {
          // Wait for Network.loadingFinished event (indicates response is complete)
          // No timeout - wait until response actually finishes
          await responseFinishedPromise;
          
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
          
          // Find and click copy-button directly (it should be in DOM already)
          let copyButton = await page.$('copy-button');
          if (copyButton) {
            try {
              // Try to find the actual button element inside copy-button
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
              } else {
                // Fallback: click copy-button directly
                await copyButton.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
                await new Promise((r) => setTimeout(r, 300));
                await copyButton.focus();
                await copyButton.click({ timeout: 2000 });
                await new Promise((r) => setTimeout(r, 1000));
              }
            } catch (clickErr) {
              // Fallback: try clicking using evaluate
              const clicked = await page.evaluate(() => {
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
              
              if (clicked) {
                await new Promise((r) => setTimeout(r, 1000));
              }
            }
          }
        } catch (e) {
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
    return { status };
  } catch (e) {
    return { status: 'failed', error: e?.message || String(e) };
  } finally {
    try { browser.disconnect(); } catch (_) {}
  }
}

module.exports = { sendPrompt };



