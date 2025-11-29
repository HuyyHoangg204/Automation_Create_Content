const path = require('path');
const { listChromeProfiles, getProfilesBaseDir } = require('../services/chrome');

/**
 * Sanitize name để tạo folder name an toàn
 */
function sanitizeName(name) {
  return String(name).replace(/[^a-zA-Z0-9-_\.]/g, '_').slice(0, 100) || 'profile';
}

/**
 * Utility function để resolve đường dẫn đầy đủ của userDataDir từ tên folder
 * Hỗ trợ tự động tìm path trên các máy khác nhau (user khác nhau)
 * 
 * Ví dụ:
 * - Input: profileDirName = "Profile_username"
 * - Output: "C:\Users\tranh\AppData\Local\Automation_Profiles\Profile_username"
 * 
 * Logic:
 * 1. Nếu userDataDir đã là absolute path → return ngay
 * 2. Ưu tiên sử dụng profileDirName nếu có
 * 3. Tìm trong profiles index trước (theo userDataDir nếu là folder name, hoặc theo name)
 * 4. Nếu không tìm thấy → build từ profilesBaseDir + folder name
 * 
 * @param {Object} params - Parameters
 * @param {string} [params.userDataDir] - Có thể là absolute path hoặc chỉ tên folder (ví dụ: "Profile_huyyyhoang2004")
 * @param {string} [params.name] - Tên profile (optional, dùng để tìm nếu không có userDataDir)
 * @param {string} [params.profileDirName] - Tên folder profile (ưu tiên, ví dụ: "Profile_username")
 * @returns {Promise<string>} - Absolute path của userDataDir
 */
async function resolveUserDataDir({ userDataDir, name, profileDirName }) {
  if (userDataDir && (userDataDir.includes(path.sep) || userDataDir.includes('/') || userDataDir.includes('\\'))) {
    if (path.isAbsolute(userDataDir)) {
      return userDataDir;
    }
  }

  const folderNameToUse = profileDirName || userDataDir || name;
  const searchKey = folderNameToUse;
  if (searchKey) {
    try {
      const profiles = await listChromeProfiles();
      const matchedProfiles = profiles.filter((p) => {
        if (p.name === searchKey || p.dirName === searchKey) {
          return true;
        }
        if (userDataDir && p.userDataDir) {
          const basename = path.basename(p.userDataDir);
          return basename === userDataDir || basename === searchKey;
        }
        return false;
      });

      if (matchedProfiles.length > 0) {
        return matchedProfiles[0].userDataDir;
      }
    } catch (error) {
      // Ignore
    }
  }

  const profilesBase = await getProfilesBaseDir();
  const folderName = profileDirName || userDataDir || sanitizeName(name || 'profile');
  return path.join(profilesBase, folderName);
}

async function getProfileDirNameFromIndex(userDataDir, name) {
  try {
    const profiles = await listChromeProfiles();
    const profile = profiles.find((p) => {
      if (userDataDir && p.userDataDir) {
        if (path.isAbsolute(userDataDir)) {
          return path.normalize(userDataDir) === path.normalize(p.userDataDir);
        } else {
          return path.basename(p.userDataDir) === userDataDir;
        }
      }
      if (name && (p.name === name || p.dirName === name)) {
        return true;
      }
      return false;
    });
    
    if (profile) {
      return profile.dirName || profile.name;
    }
  } catch (error) {
    // Ignore
  }
  return null;
}

module.exports = { resolveUserDataDir, getProfileDirNameFromIndex };

