const path = require('path');
const os = require('os');
const constants = require('./constants/constants');

// Get root directory - use __dirname if available (CommonJS), otherwise process.cwd()
const rootDir = typeof __dirname !== 'undefined' 
  ? __dirname.replace(/[\\/]src$/, '') // Remove /src if present
  : process.cwd();

// Default profiles folder - dùng folder mà các app khác hay dùng
function getDefaultProfilesDir() {
  const platform = process.platform;
  if (platform === 'win32') {
    // Windows: dùng AppData\Local (folder chung cho các app)
    return path.join(os.homedir(), 'AppData', 'Local', 'Automation_Profiles');
  } else if (platform === 'darwin') {
    // macOS: dùng ~/Library/Application Support
    return path.join(os.homedir(), 'Library', 'Application Support', 'Automation_Profiles');
  } else {
    // Linux: dùng ~/.config
    return path.join(os.homedir(), '.config', 'automation_profiles');
  }
}

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  rootDir,
  uploadDir: process.env.UPLOAD_DIR || path.join(rootDir, 'uploads'),
  defaultProfilesDir: getDefaultProfilesDir(),
  profileIdleTimeout: constants.PROFILE_IDLE_TIMEOUT,
};


