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
 * - Input: userDataDir = "Profile_huyyyhoang2004"
 * - Output: "C:\Users\tranh\AppData\Local\Automation_Profiles\Profile_huyyyhoang2004"
 * 
 * Logic:
 * 1. Nếu userDataDir đã là absolute path → return ngay
 * 2. Tìm trong profiles index trước (theo userDataDir nếu là folder name, hoặc theo name)
 * 3. Nếu không tìm thấy → build từ profilesBaseDir + folder name
 * 
 * @param {Object} params - Parameters
 * @param {string} [params.userDataDir] - Có thể là absolute path hoặc chỉ tên folder (ví dụ: "Profile_huyyyhoang2004")
 * @param {string} [params.name] - Tên profile (optional, dùng để tìm nếu không có userDataDir)
 * @returns {Promise<string>} - Absolute path của userDataDir
 */
async function resolveUserDataDir({ userDataDir, name }) {
  // 1. Nếu userDataDir đã là absolute path (chứa path separator), return ngay
  if (userDataDir && (userDataDir.includes(path.sep) || userDataDir.includes('/') || userDataDir.includes('\\'))) {
    // Kiểm tra xem có phải absolute path không
    if (path.isAbsolute(userDataDir)) {
      return userDataDir;
    }
  }

  // 2. Tìm trong profiles index trước (theo userDataDir nếu là folder name, hoặc theo name)
  const searchKey = userDataDir || name;
  if (searchKey) {
    try {
      const profiles = await listChromeProfiles();
      // Tìm profile theo userDataDir (nếu là folder name) hoặc theo name/dirName
      const profile = profiles.find((p) => {
        // So sánh với name hoặc dirName
        if (p.name === searchKey || p.dirName === searchKey) {
          return true;
        }
        // So sánh với basename của userDataDir (nếu userDataDir là folder name)
        if (userDataDir && p.userDataDir) {
          const basename = path.basename(p.userDataDir);
          return basename === userDataDir || basename === searchKey;
        }
        return false;
      });

      if (profile && profile.userDataDir) {
        return profile.userDataDir;
      }
    } catch (error) {
      // Nếu lỗi khi load profiles index, tiếp tục build từ defaultProfilesDir
    }
  }

  // 3. Fallback: Build từ profilesBaseDir + folder name
  const profilesBase = await getProfilesBaseDir();
  const folderName = userDataDir || sanitizeName(name || 'profile');
  return path.join(profilesBase, folderName);
}

module.exports = { resolveUserDataDir };

