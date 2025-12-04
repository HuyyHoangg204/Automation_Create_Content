const { connectToBrowserByUserDataDir, launchChromeProfile, listChromeProfiles } = require('../services/chrome');
const { ensureGmailLoggedIn } = require('../scripts/gmailLogin');

/**
 * Wait for Chrome to be ready to connect via remote debugging
 * @param {string} userDataDir - Chrome user data directory
 * @param {number} [preferPort] - Optional DevTools port
 * @param {number} [timeout] - Timeout in milliseconds (default: 30000)
 * @returns {Promise<{ready: boolean, port: number, error?: string}>}
 */
async function waitForChromeReady(userDataDir, preferPort, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const { browser, port } = await connectToBrowserByUserDataDir(userDataDir, preferPort);
      try {
        browser.disconnect();
      } catch (_) {
        // Ignore disconnect errors
      }
      return { ready: true, port };
    } catch (error) {
      lastError = error;
      // Wait 500ms before retry
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return {
    ready: false,
    port: preferPort || 9222,
    error: lastError?.message || 'Chrome not ready within timeout'
  };
}

/**
 * Wait for Gmail to be logged in
 * @param {string} userDataDir - Chrome user data directory
 * @param {number} [preferPort] - Optional DevTools port
 * @param {number} [timeout] - Timeout in milliseconds (default: 60000)
 * @returns {Promise<{loggedIn: boolean, status: string, error?: string}>}
 */
async function waitForGmailLogin(userDataDir, preferPort, timeout = 60000) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  let lastStatus = 'unknown';

  while (Date.now() < deadline) {
    try {
      const { browser } = await connectToBrowserByUserDataDir(userDataDir, preferPort);
      try {
        const page = await browser.newPage();
        try {
          await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 15000 });
          const host = (() => {
            try {
              return new URL(page.url()).hostname;
            } catch {
              return '';
            }
          })();

          if (!host.includes('accounts.google.com')) {
            // Not on login page, assume logged in
            lastStatus = 'logged_in';
            try {
              await page.close({ runBeforeUnload: true });
            } catch (_) {
              // Ignore
            }
            try {
              browser.disconnect();
            } catch (_) {
              // Ignore
            }
            return { loggedIn: true, status: 'logged_in' };
          }

          // Still on login page
          try {
            await page.close({ runBeforeUnload: true });
          } catch (_) {
            // Ignore
          }
        } catch (pageError) {
          lastError = pageError;
          try {
            await page.close({ runBeforeUnload: true });
          } catch (_) {
            // Ignore
          }
        }

        try {
          browser.disconnect();
        } catch (_) {
          // Ignore
        }

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (browserError) {
        lastError = browserError;
        try {
          browser.disconnect();
        } catch (_) {
          // Ignore
        }
        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (error) {
      lastError = error;
      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  return {
    loggedIn: false,
    status: lastStatus,
    error: lastError?.message || 'Gmail not logged in within timeout'
  };
}

/**
 * Execute workflow steps sequentially
 * @param {Array} steps - Array of step definitions
 * @param {Object} context - Shared context between steps
 * @returns {Promise<{success: boolean, results: Array, errors: Array}>}
 */
async function executeSteps(steps = [], context = {}) {
  const results = [];
  const errors = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepType = step.type;
    const stepParams = step.params || {};
    const stepTimeout = step.timeout || 30000;

    try {
      let result = null;

      switch (stepType) {
        case 'launch': {
          // Launch Chrome profile
          const launchParams = {
            name: stepParams.name || context.name,
            userDataDir: stepParams.userDataDir || context.userDataDir,
            profileDirName: stepParams.profileDirName || context.profileDirName || 'Default',
            extraArgs: stepParams.extraArgs || context.extraArgs || [],
            ensureGmail: stepParams.ensureGmail !== undefined ? stepParams.ensureGmail : context.ensureGmail,
            headless: stepParams.headless !== undefined ? stepParams.headless : context.headless
          };

          // Resolve userDataDir if only name provided
          if (!launchParams.userDataDir && launchParams.name) {
            const profiles = await listChromeProfiles();
            const profile = profiles.find((p) => p.name === launchParams.name || p.dirName === launchParams.name);
            if (!profile) {
              throw new Error(`Profile not found: ${launchParams.name}`);
            }
            launchParams.userDataDir = profile.userDataDir;
          }

          if (!launchParams.userDataDir) {
            throw new Error('Either name or userDataDir must be provided for launch step');
          }

          result = await launchChromeProfile(launchParams);
          
          // Update context with launch result
          context.userDataDir = result.userDataDir || launchParams.userDataDir;
          context.pid = result.pid;
          context.debugPort = result.launchArgs?.find((a) => a.includes('--remote-debugging-port='))?.split('=')[1] || 9222;
          context.gmailCheckStatus = result.gmailCheckStatus;

          break;
        }

        case 'wait-chrome-ready': {
          // Wait for Chrome to be ready
          const waitParams = {
            userDataDir: stepParams.userDataDir || context.userDataDir,
            preferPort: stepParams.debugPort || context.debugPort ? parseInt(context.debugPort, 10) : undefined,
            timeout: stepTimeout
          };

          if (!waitParams.userDataDir) {
            throw new Error('userDataDir not found in context for wait-chrome-ready step');
          }

          result = await waitForChromeReady(waitParams.userDataDir, waitParams.preferPort, waitParams.timeout);

          if (!result.ready) {
            throw new Error(`Chrome not ready: ${result.error}`);
          }

          // Update context with port
          if (result.port) {
            context.debugPort = result.port;
          }

          break;
        }

        case 'wait-gmail-login': {
          // Wait for Gmail to be logged in
          const waitParams = {
            userDataDir: stepParams.userDataDir || context.userDataDir,
            preferPort: stepParams.debugPort || context.debugPort ? parseInt(context.debugPort, 10) : undefined,
            timeout: stepTimeout
          };

          if (!waitParams.userDataDir) {
            throw new Error('userDataDir not found in context for wait-gmail-login step');
          }

          result = await waitForGmailLogin(waitParams.userDataDir, waitParams.preferPort, waitParams.timeout);

          if (!result.loggedIn) {
            throw new Error(`Gmail not logged in: ${result.error || result.status}`);
          }

          // Update context with login status
          context.gmailLoggedIn = true;
          context.gmailStatus = result.status;

          break;
        }

        case 'ensure-gmail-login': {
          // Ensure Gmail is logged in (try to login if not)
          const { getGoogleAccount } = require('../utils/googleAccount');
          const defaultCred = getGoogleAccount(); // Get from saved file first, then constants
          const ensureParams = {
            userDataDir: stepParams.userDataDir || context.userDataDir,
            debugPort: stepParams.debugPort || context.debugPort ? parseInt(context.debugPort, 10) : undefined,
            email: stepParams.email || context.email || (defaultCred?.email || ''),
            password: stepParams.password || context.password || (defaultCred?.password || '')
          };

          if (!ensureParams.userDataDir) {
            throw new Error('userDataDir not found in context for ensure-gmail-login step');
          }

          result = await ensureGmailLoggedIn({
            userDataDir: ensureParams.userDataDir,
            email: ensureParams.email || '',
            password: ensureParams.password || '',
            debugPort: ensureParams.debugPort
          });

          // Update context
          context.gmailLoggedIn = result.status === 'already_logged_in' || result.status === 'logged_in';
          context.gmailStatus = result.status;

          break;
        }

        case 'custom': {
          // Custom step with custom function
          if (!step.execute || typeof step.execute !== 'function') {
            throw new Error('Custom step must have an execute function');
          }
          result = await step.execute(context);
          break;
        }

        default:
          throw new Error(`Unknown step type: ${stepType}`);
      }

      results.push({
        stepIndex: i,
        stepType,
        success: true,
        result
      });

      // Update context with step result
      context[`step_${i}_result`] = result;
    } catch (error) {
      const errorInfo = {
        stepIndex: i,
        stepType,
        success: false,
        error: error.message || String(error),
        stack: error.stack
      };

      errors.push(errorInfo);
      results.push(errorInfo);

      // If step has stopOnError flag or it's the last step, stop execution
      if (step.stopOnError !== false) {
        // Default is to stop on error
        break;
      }
    }
  }

  const success = errors.length === 0;

  return {
    success,
    results,
    errors,
    context
  };
}

module.exports = {
  executeSteps,
  waitForChromeReady,
  waitForGmailLogin
};

