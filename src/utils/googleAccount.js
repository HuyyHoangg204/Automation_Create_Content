const fs = require('fs');
const path = require('path');
const os = require('os');
const { ACCOUNT_GOOGLE } = require('../constants/constants');

/**
 * Get Google account from saved file (priority) or from constants (.env)
 * @returns {Object} { email: string, password: string } or null
 */
function getGoogleAccount() {
  try {
    // 1. Try to read from saved file first (highest priority)
    const filePath = path.join(os.homedir(), 'AppData', 'Local', 'Automation_Profiles', 'google-account.json');
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      const account = JSON.parse(data);
      if (account && account.email && account.password) {
        return {
          email: account.email,
          password: account.password
        };
      }
    }
  } catch (error) {
    // Error reading file, fallback to constants
    console.warn('[GoogleAccount] Failed to read saved account file:', error.message);
  }

  // 2. Fallback to constants from .env
  if (ACCOUNT_GOOGLE && Array.isArray(ACCOUNT_GOOGLE) && ACCOUNT_GOOGLE.length > 0) {
    const account = ACCOUNT_GOOGLE[0];
    if (account && account.email && account.password) {
      return {
        email: account.email,
        password: account.password
      };
    }
  }

  return null;
}

/**
 * Get all Google accounts (from file + constants)
 * @returns {Array} Array of { email: string, password: string }
 */
function getAllGoogleAccounts() {
  const accounts = [];

  // 1. Add saved account from file (if exists)
  try {
    const filePath = path.join(os.homedir(), 'AppData', 'Local', 'Automation_Profiles', 'google-account.json');
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      const account = JSON.parse(data);
      if (account && account.email && account.password) {
        accounts.push({
          email: account.email,
          password: account.password
        });
      }
    }
  } catch (error) {
    // Ignore
  }

  // 2. Add accounts from constants (avoid duplicates)
  if (ACCOUNT_GOOGLE && Array.isArray(ACCOUNT_GOOGLE)) {
    ACCOUNT_GOOGLE.forEach(account => {
      if (account && account.email && account.password) {
        // Only add if not already in list (by email)
        const exists = accounts.some(a => a.email === account.email);
        if (!exists) {
          accounts.push({
            email: account.email,
            password: account.password
          });
        }
      }
    });
  }

  return accounts;
}

module.exports = {
  getGoogleAccount,
  getAllGoogleAccounts
};

