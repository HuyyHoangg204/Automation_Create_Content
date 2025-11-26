const fs = require('fs-extra');
const path = require('path');
const { logger } = require('../logger');

/**
 * Download một file từ URL về thư mục đích
 * @param {Object} params
 * @param {string} params.fileUrl - URL của file cần download
 * @param {string} params.destinationDir - Thư mục đích để lưu file
 * @param {string} [params.filename] - Tên file tùy chỉnh (optional)
 * @returns {Promise<{success: boolean, filePath?: string, filename?: string, size?: number, mimetype?: string, error?: string}>}
 */
async function downloadFile({ fileUrl, destinationDir, filename }) {
  try {
    // Validate URL
    if (!fileUrl || (typeof fileUrl !== 'string')) {
      throw new Error('fileUrl is required and must be a string');
    }

    if (!fileUrl.startsWith('http://') && !fileUrl.startsWith('https://')) {
      throw new Error('fileUrl must start with http:// or https://');
    }

    // Ensure destination directory exists
    await fs.ensureDir(destinationDir);

    // Fetch file từ URL
    const response = await fetch(fileUrl);

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
    }

    // Determine filename
    let finalFilename = filename;
    if (!finalFilename) {
      // Try to get filename from Content-Disposition header
      const contentDisposition = response.headers.get('Content-Disposition');
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (filenameMatch && filenameMatch[1]) {
          finalFilename = filenameMatch[1].replace(/['"]/g, '').trim();
        }
      }

      // Fallback: extract từ URL
      if (!finalFilename) {
        try {
          const urlPath = new URL(fileUrl).pathname;
          finalFilename = path.basename(urlPath) || `file-${Date.now()}`;
        } catch {
          finalFilename = `file-${Date.now()}`;
        }
      }
    }

    // Sanitize filename (loại bỏ ký tự đặc biệt)
    finalFilename = finalFilename.replace(/[<>:"/\\|?*]/g, '_').trim();
    if (!finalFilename) {
      finalFilename = `file-${Date.now()}`;
    }

    const filePath = path.join(destinationDir, finalFilename);

    // Download file content
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await fs.writeFile(filePath, buffer);

    const stats = await fs.stat(filePath);
    const mimetype = response.headers.get('Content-Type') || 'application/octet-stream';

    return {
      success: true,
      filePath,
      filename: finalFilename,
      size: stats.size,
      mimetype
    };
  } catch (error) {
    logger.error({ fileUrl, error: error.message }, '[DownloadFile] Download failed');
    return {
      success: false,
      error: error.message || String(error)
    };
  }
}

/**
 * Download nhiều files từ URLs về thư mục đích
 * @param {Object} params
 * @param {string[]} params.fileUrls - Mảng các URLs cần download
 * @param {string} params.destinationDir - Thư mục đích để lưu files
 * @returns {Promise<{success: boolean, results: Array, summary: {total: number, success: number, failed: number}}>}
 */
async function downloadFiles({ fileUrls, destinationDir }) {
  const results = [];
  let successCount = 0;
  let failedCount = 0;

  for (const fileUrl of fileUrls) {
    const result = await downloadFile({
      fileUrl,
      destinationDir
    });

    results.push({
      fileUrl,
      ...result
    });

    if (result.success) {
      successCount++;
    } else {
      failedCount++;
    }
  }

  return {
    success: failedCount === 0,
    results,
    summary: {
      total: fileUrls.length,
      success: successCount,
      failed: failedCount
    }
  };
}

module.exports = { downloadFile, downloadFiles };

