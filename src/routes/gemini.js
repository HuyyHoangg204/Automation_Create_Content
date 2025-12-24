const express = require('express');
const { z } = require('zod');
const path = require('path');
const fs = require('fs-extra');
const { logger } = require('../logger');
const { resolveUserDataDir } = require('../utils/resolveUserDataDir');
const { downloadFiles } = require('../utils/downloadFile');
const { createGem } = require('../scripts/gemini');
const { saveGoogleAccount } = require('../utils/googleAccount');
const { listGems } = require('../scripts/listGems');
const { sendPrompt, sendNextPrompt } = require('../scripts/sendPrompt');
const { launchNotebookLM } = require('../scripts/notebooklm');
const logService = require('../services/logService');
const entityContextService = require('../services/entityContext');
const profileMonitorService = require('../services/profileMonitor');
const profileStatusEvent = require('../services/profileStatusEvent');
const { stopChromeProfile, launchChromeProfile } = require('../services/chrome');

const router = express.Router();

const bodySchema = z.object({
  name: z.string().min(1).optional(), // profile name
  userDataDir: z.string().min(1).optional(),
  profileDirName: z.string().min(1).optional().default('Default'),
  gemName: z.string().optional(),
  description: z.string().optional(),
  instructions: z.string().optional(),
  knowledgeFiles: z.array(z.string()).optional(),
  debugPort: z.number().int().positive().optional(),
}).refine((d) => !!d.name || !!d.userDataDir, {
  message: 'Either name or userDataDir must be provided',
  path: ['name'],
});

router.post('/gems', async (req, res, next) => {
  try {
    const parsed = bodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'ValidationError', details: parsed.error.issues });
    }

    const { name, userDataDir: inputUserDataDir, profileDirName, gemName, description, instructions, knowledgeFiles, debugPort } = parsed.data;

    // Extract entity info
    const entityID = req.headers['x-entity-id'] || req.body.entity_id || 'unknown';
    const userID = req.headers['x-user-id'] || req.body.user_id || 'unknown';

    // Auto-resolve userDataDir từ tên folder (hỗ trợ các máy khác nhau với user khác nhau)
    const userDataDir = await resolveUserDataDir({
      userDataDir: inputUserDataDir,
      name,
      profileDirName
    });

    // Lấy entity context từ entityContextService (đã lưu khi launch Chrome)
    // QUAN TRỌNG: Key phải khớp với key đã lưu trong chrome.js
    // chrome.js lưu với key = finalProfileDirName (từ profile.json hoặc getProfileDirNameFromIndex)
    // Cần resolve finalProfileDirName giống như chrome.js
    const fs = require('fs-extra');
    const profileJsonPath = require('path').join(userDataDir, 'profile.json');
    let finalProfileDirName = profileDirName || 'Default';
    
    if (await fs.pathExists(profileJsonPath)) {
      try {
        const profileMeta = await fs.readJson(profileJsonPath);
        if (profileMeta.profileDirName) {
          finalProfileDirName = profileMeta.profileDirName;
        }
      } catch (_) {
      }
    } else if (!profileDirName) {
      // Nếu không có profile.json và không có profileDirName, dùng getProfileDirNameFromIndex
      const { getProfileDirNameFromIndex } = require('../utils/resolveUserDataDir');
      const profileDirNameFromIndex = await getProfileDirNameFromIndex(userDataDir, name);
      finalProfileDirName = profileDirNameFromIndex || 'Default';
    }
    
    // Dùng finalProfileDirName làm key (giống chrome.js)
    const contextKey = finalProfileDirName;
    const savedContext = entityContextService.get(contextKey);

    // Extract entity info: ưu tiên context đã lưu, sau đó headers, cuối cùng body, fallback "unknown"
    let finalEntityType = 'topic';
    let finalEntityID = 'unknown';
    let finalUserID = 'unknown';

    if (savedContext) {
      finalEntityType = savedContext.entityType || 'topic';
      finalEntityID = savedContext.entityID || 'unknown';
      finalUserID = savedContext.userID || 'unknown';
    } else {
      // Fallback: lấy từ headers hoặc body
      finalEntityType = req.headers['x-entity-type'] || req.body.entity_type || 'topic';
      finalEntityID = req.headers['x-entity-id'] || req.body.entity_id || 'unknown';
      finalUserID = req.headers['x-user-id'] || req.body.user_id || 'unknown';
    }

    // Bước 2: Download files từ URLs về profile folder (nếu knowledgeFiles chứa URLs)
    let finalKnowledgeFiles = knowledgeFiles || [];

    if (knowledgeFiles && knowledgeFiles.length > 0) {
      // Normalize URLs: thêm http:// nếu thiếu protocol (ví dụ: localhost:8080/...)
      const normalizedFiles = knowledgeFiles.map(file => {
        if (typeof file === 'string') {
          // Nếu đã có protocol, giữ nguyên
          if (file.startsWith('http://') || file.startsWith('https://')) {
            return file;
          }

          // Nếu là absolute path (Windows: C:\..., Unix: /...), giữ nguyên
          if (path.isAbsolute(file) || file.startsWith('/')) {
            return file;
          }

          // Kiểm tra xem có phải URL thiếu protocol không (pattern: hostname:port/path)
          // Ví dụ: localhost:8080/api/..., example.com:3000/files/...
          if (file.match(/^[a-zA-Z0-9.-]+:\d+\//) || file.match(/^[a-zA-Z0-9.-]+:\d+$/)) {
            // Có vẻ là URL nhưng thiếu protocol
            return `http://${file}`;
          }
        }
        return file;
      });

      // Phân loại: URLs (http/https) vs local paths
      const urlFiles = normalizedFiles.filter(file =>
        typeof file === 'string' && (file.startsWith('http://') || file.startsWith('https://'))
      );
      const localFiles = normalizedFiles.filter(file =>
        typeof file === 'string' && !file.startsWith('http://') && !file.startsWith('https://')
      );


      // Log: Bắt đầu download files (info) - cho cả URL files và local files
      if (urlFiles.length > 0 || localFiles.length > 0) {
        await logService.logInfo(finalEntityType, finalEntityID, finalUserID, 'files_downloading',
          `Bắt đầu download files từ URLs`, {
          files_count: urlFiles.length + localFiles.length,
          url_files_count: urlFiles.length,
          local_files_count: localFiles.length,
          gem_name: gemName || name || 'unknown'
        });
      }

      if (urlFiles.length > 0) {
        // Tạo thư mục knowledge_files trong profile folder
        const knowledgeFilesDir = path.join(userDataDir, 'knowledge_files');
        await fs.ensureDir(knowledgeFilesDir);


        // Download files từ URLs
        const downloadResult = await downloadFiles({
          fileUrls: urlFiles,
          destinationDir: knowledgeFilesDir
        });

        // Log kết quả download
        if (downloadResult.summary.failed > 0) {

          await logService.logError(finalEntityType, finalEntityID, finalUserID, 'files_downloaded',
            `Một số files download thất bại: ${downloadResult.summary.failed}/${downloadResult.summary.total}`, {
            files_count: downloadResult.summary.total,
            success_count: downloadResult.summary.success,
            failed_count: downloadResult.summary.failed,
            gem_name: gemName || name || 'unknown'
          });
        } else {

          await logService.logSuccess(finalEntityType, finalEntityID, finalUserID, 'files_downloaded',
            `Đã download xong tất cả files`, {
            files_count: downloadResult.summary.total,
            gem_name: gemName || name || 'unknown'
          });
        }

        // Lấy local paths từ kết quả download (chỉ lấy những file download thành công)
        const downloadedLocalPaths = downloadResult.results
          .filter(r => r.success && r.filePath)
          .map(r => r.filePath);

        // Kết hợp local paths (từ download) + local files (đã có sẵn)
        finalKnowledgeFiles = [...downloadedLocalPaths, ...localFiles];

      } else {
        // Không có URLs, giữ nguyên knowledgeFiles
        finalKnowledgeFiles = knowledgeFiles;
      }
    }

    // Log: Gem creating
    await logService.logInfo(finalEntityType, finalEntityID, finalUserID, 'gem_creating',
      `Bắt đầu tạo Gem trên Gemini`, {
      gem_name: gemName || name || 'unknown',
      files_count: finalKnowledgeFiles.length
    });

    // Bước 3: Tạo Gem với local file paths
    const out = await createGem({
      userDataDir,
      name: gemName,
      description,
      instructions,
      knowledgeFiles: finalKnowledgeFiles,
      debugPort,
      entityType: finalEntityType,
      entityID: finalEntityID,
      userID: finalUserID
    });

    // Kiểm tra status từ createGem để xác định có thành công không
    const gemStatus = out.status || 'unknown';
    const gemId = out.id || out.gem_id || out.gemId || 'unknown';
    const finalGemName = out.name || gemName || name || 'unknown';

    // Chỉ log success khi thực sự tạo thành công (status = 'gem_created')
    if (gemStatus === 'gem_created' && !out.error) {
      await logService.logSuccess(finalEntityType, finalEntityID, finalUserID, 'gem_created',
        'Gem đã được tạo thành công trên Gemini', {
        gem_name: finalGemName,
        files_count: finalKnowledgeFiles.length,
        gem_id: gemId !== 'unknown' ? gemId : undefined
      });

      // Log: Completed
      await logService.logSuccess(finalEntityType, finalEntityID, finalUserID, 'create_gem_completed',
        'Toàn bộ quá trình hoàn thành', {
        gem_name: finalGemName,
        files_count: finalKnowledgeFiles.length,
        gem_id: gemId !== 'unknown' ? gemId : undefined
      });
    } else if (gemStatus === 'gem_form_filled_but_not_saved') {
      // Log warning nếu form đã được điền nhưng không save được
      await logService.logWarning(finalEntityType, finalEntityID, finalUserID, 'gem_creating',
        'Gem form đã được điền nhưng không thể save (có thể bị treo ở modal)', {
        gem_name: finalGemName,
        status: gemStatus,
        files_count: finalKnowledgeFiles.length
      });
    } else {
      // Log warning cho các trường hợp khác
      await logService.logError(finalEntityType, finalEntityID, finalUserID, 'gem_creating',
        `Gem creation không hoàn thành: status=${gemStatus}`, {
        gem_name: finalGemName,
        status: gemStatus,
        error: out.error || undefined
      });
    }

    return res.json(out);
  } catch (err) {
    // Log error - cần resolve lại context vì có thể chưa resolve userDataDir
    const { name: errorName, userDataDir: errorUserDataDir, profileDirName: errorProfileDirName } = req.body || {};
    let errorContextKey = null;
    let errorContext = null;

    try {
      const errorResolvedUserDataDir = await resolveUserDataDir({
        userDataDir: errorUserDataDir,
        name: errorName,
        profileDirName: errorProfileDirName
      });
      errorContextKey = errorProfileDirName || errorResolvedUserDataDir;
      errorContext = entityContextService.get(errorContextKey);
    } catch (_) {
      // Ignore
    }

    const errorEntityType = errorContext?.entityType || req.headers['x-entity-type'] || req.body.entity_type || 'topic';
    const errorEntityID = errorContext?.entityID || req.headers['x-entity-id'] || req.body.entity_id || 'unknown';
    const errorUserID = errorContext?.userID || req.headers['x-user-id'] || req.body.user_id || 'unknown';

    await logService.logError(errorEntityType, errorEntityID, errorUserID, 'gem_creating',
      `Failed to create Gem: ${err.message}`, { error: err.message });

    return next(err);
  }
});

const syncSchema = z.object({
  name: z.string().min(1).optional(), // profile name
  userDataDir: z.string().min(1).optional(),
  profileDirName: z.string().min(1).optional().default('Default'),
  debugPort: z.number().int().positive().optional(),
}).refine((d) => !!d.name || !!d.userDataDir, {
  message: 'Either name or userDataDir must be provided',
  path: ['name'],
});

router.post('/gems/sync', async (req, res, next) => {
  try {
    const parsed = syncSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'ValidationError', details: parsed.error.issues });
    const { name, userDataDir: inputUserDataDir, profileDirName, debugPort } = parsed.data;

    // Auto-resolve userDataDir từ tên folder
    const userDataDir = await resolveUserDataDir({
      userDataDir: inputUserDataDir,
      name,
      profileDirName
    });

    const out = await listGems({ userDataDir, debugPort });
    return res.json(out);
  } catch (err) {
    return next(err);
  }
});

const sendPromptSchema = z.object({
  name: z.string().min(1).optional(), // profile name
  userDataDir: z.string().min(1).optional(),
  profileDirName: z.string().min(1).optional().default('Default'),
  debugPort: z.number().int().positive().optional(),
  gem: z.string().min(1), // Gem name to select
  listFile: z.array(z.string()).optional(), // Array of file paths to upload
  prompt: z.string().min(1), // Prompt text to send
}).refine((d) => !!d.name || !!d.userDataDir, {
  message: 'Either name or userDataDir must be provided',
  path: ['name'],
});

router.post('/gems/send-prompt', async (req, res, next) => {
  try {
    const parsed = sendPromptSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'ValidationError', details: parsed.error.issues });
    const { name, userDataDir: inputUserDataDir, profileDirName, debugPort, gem, listFile, prompt } = parsed.data;

    // Auto-resolve userDataDir từ tên folder
    const userDataDir = await resolveUserDataDir({
      userDataDir: inputUserDataDir,
      name,
      profileDirName
    });

    const out = await sendPrompt({ userDataDir, debugPort, gem, listFile, prompt });
    return res.json(out);
  } catch (err) {
    return next(err);
  }
});

const generateOutlineSchema = z.object({
  name: z.string().min(1).optional(),
  userDataDir: z.string().min(1).optional(),
  profileDirName: z.string().min(1).optional().default('Default'),
  debugPort: z.number().int().positive().optional(),
  gem: z.string().min(1),
  notebooklmPrompt: z.string().min(1),
  website: z.array(z.string().url()).optional(),
  youtube: z.array(z.string().url()).optional(),
  textContent: z.string().optional(),
  sendPromptText: z.string().optional(),
}).refine((d) => !!d.name || !!d.userDataDir, {
  message: 'Either name or userDataDir must be provided',
  path: ['name'],
});

router.post('/generate-outline-and-upload', async (req, res, next) => {
  try {
    const parsed = generateOutlineSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'ValidationError', details: parsed.error.issues });
    }

    const {
      name,
      userDataDir: inputUserDataDir,
      profileDirName,
      debugPort,
      gem,
      notebooklmPrompt,
      website,
      youtube,
      textContent,
      sendPromptText
    } = parsed.data;

    const userDataDir = await resolveUserDataDir({
      userDataDir: inputUserDataDir,
      name,
      profileDirName
    });

    // Lấy entity context từ entityContextService (đã lưu khi launch Chrome)
    // QUAN TRỌNG: Key phải khớp với key đã lưu trong chrome.js
    // chrome.js lưu với key = finalProfileDirName (từ profile.json hoặc getProfileDirNameFromIndex)
    // Cần resolve finalProfileDirName giống như chrome.js
    const fs = require('fs-extra');
    const profileJsonPath = require('path').join(userDataDir, 'profile.json');
    let finalProfileDirName = profileDirName || 'Default';
    
    if (await fs.pathExists(profileJsonPath)) {
      try {
        const profileMeta = await fs.readJson(profileJsonPath);
        if (profileMeta.profileDirName) {
          finalProfileDirName = profileMeta.profileDirName;
        }
      } catch (_) {
      }
    } else if (!profileDirName) {
      // Nếu không có profile.json và không có profileDirName, dùng getProfileDirNameFromIndex
      const { getProfileDirNameFromIndex } = require('../utils/resolveUserDataDir');
      const profileDirNameFromIndex = await getProfileDirNameFromIndex(userDataDir, name);
      finalProfileDirName = profileDirNameFromIndex || 'Default';
    }
    
    // Dùng finalProfileDirName làm key (giống chrome.js)
    const contextKey = finalProfileDirName;
    const savedContext = entityContextService.get(contextKey);

    let finalEntityType = 'topic';
    let finalEntityID = 'unknown';
    let finalUserID = 'unknown';

    if (savedContext) {
      finalEntityType = savedContext.entityType || 'topic';
      finalEntityID = savedContext.entityID || 'unknown';
      finalUserID = savedContext.userID || 'unknown';
    } else {
      finalEntityType = req.headers['x-entity-type'] || req.body.entity_type || 'topic';
      finalEntityID = req.headers['x-entity-id'] || req.body.entity_id || 'unknown';
      finalUserID = req.headers['x-user-id'] || req.body.user_id || 'unknown';
    }

    await logService.logInfo(finalEntityType, finalEntityID, finalUserID, 'outline_generation_started',
      'Bắt đầu tạo dàn ý bằng NotebookLM', {
      gem_name: gem,
      has_website: !!(website && website.length > 0),
      has_youtube: !!(youtube && youtube.length > 0),
      has_text_content: !!textContent
    });

    if (profileMonitorService.setAutomationStatus(userDataDir, finalProfileDirName, 'running')) {
      profileStatusEvent.emitAutomationStatusChange(finalProfileDirName || userDataDir, 'running', {
        userDataDir,
        profileDirName: finalProfileDirName,
        entityType: finalEntityType,
        entityID: finalEntityID,
        userID: finalUserID
      });
    }

    const outlinesDir = path.join(userDataDir, 'outlines');
    if (!fs.existsSync(outlinesDir)) {
      fs.mkdirSync(outlinesDir, { recursive: true });
    }

    const timestamp = Date.now();
    const outlineFileName = `outline_${timestamp}.txt`;
    const outlineFilePath = path.join(outlinesDir, outlineFileName);

    await logService.logInfo(finalEntityType, finalEntityID, finalUserID, 'notebooklm_running',
      'Đang chạy NotebookLM để tạo dàn ý', {
      gem_name: gem,
      outline_file: outlineFileName
    });

    const notebooklmResult = await launchNotebookLM({
      userDataDir,
      debugPort,
      website,
      youtube,
      textContent,
      prompt: notebooklmPrompt,
      outputFile: outlineFilePath,
      entityType: finalEntityType,
      entityID: finalEntityID,
      userID: finalUserID
    });

    if (notebooklmResult.status === 'not_logged_in') {
      await logService.logError(finalEntityType, finalEntityID, finalUserID, 'notebooklm_not_logged_in',
        'Người dùng chưa đăng nhập NotebookLM', {
        gem_name: gem
      });

      const finalProfileDirName = profileDirName || 'Default';
      if (profileMonitorService.setAutomationStatus(userDataDir, finalProfileDirName, 'idle')) {
        profileStatusEvent.emitAutomationStatusChange(finalProfileDirName || userDataDir, 'idle', {
          userDataDir,
          profileDirName: finalProfileDirName,
          entityType: finalEntityType,
          entityID: finalEntityID,
          userID: finalUserID
        });
      }

      return res.json({
        status: 'notebooklm_not_logged_in',
        error: 'User not logged in to NotebookLM'
      });
    }

    if (notebooklmResult.status === 'failed') {
      await logService.logError(finalEntityType, finalEntityID, finalUserID, 'notebooklm_failed',
        `NotebookLM tạo dàn ý thất bại: ${notebooklmResult.error || 'Unknown error'}`, {
        gem_name: gem,
        error: notebooklmResult.error || 'Failed to generate outline'
      });

      const finalProfileDirName = profileDirName || 'Default';
      if (profileMonitorService.setAutomationStatus(userDataDir, finalProfileDirName, 'idle')) {
        profileStatusEvent.emitAutomationStatusChange(finalProfileDirName || userDataDir, 'idle', {
          userDataDir,
          profileDirName: finalProfileDirName,
          entityType: finalEntityType,
          entityID: finalEntityID,
          userID: finalUserID
        });
      }

      return res.json({
        status: 'notebooklm_failed',
        error: notebooklmResult.error || 'Failed to generate outline'
      });
    }

    if (!fs.existsSync(outlineFilePath)) {
      await logService.logError(finalEntityType, finalEntityID, finalUserID, 'outline_file_not_created',
        'File dàn ý không được tạo bởi NotebookLM', {
        gem_name: gem,
        expected_file: outlineFilePath
      });

      const finalProfileDirName = profileDirName || 'Default';
      if (profileMonitorService.setAutomationStatus(userDataDir, finalProfileDirName, 'idle')) {
        profileStatusEvent.emitAutomationStatusChange(finalProfileDirName || userDataDir, 'idle', {
          userDataDir,
          profileDirName: finalProfileDirName,
          entityType: finalEntityType,
          entityID: finalEntityID,
          userID: finalUserID
        });
      }

      return res.json({
        status: 'outline_file_not_created',
        error: 'Outline file was not created by NotebookLM'
      });
    }

    await logService.logSuccess(finalEntityType, finalEntityID, finalUserID, 'outline_generated',
      'Đã tạo dàn ý thành công từ NotebookLM', {
      gem_name: gem,
      outline_file: outlineFileName
    });

    await logService.logInfo(finalEntityType, finalEntityID, finalUserID, 'uploading_to_gemini',
      'Đang upload dàn ý lên Gemini', {
      gem_name: gem,
      outline_file: outlineFileName
    });

    const sendPromptResult = await sendPrompt({
      userDataDir,
      debugPort,
      gem,
      listFile: [outlineFilePath],
      prompt: sendPromptText || 'Đây là dàn ý đã được tạo, hãy phân tích và tạo nội dung chi tiết dựa trên dàn ý này.',
      entityType: finalEntityType,
      entityID: finalEntityID,
      userID: finalUserID,
      onProgress: async (stage, message, metadata) => {
        if (stage === 'text_copied' && metadata && metadata.text) {
          await logService.logInfo(finalEntityType, finalEntityID, finalUserID, 'text_copied',
            'Đã copy text từ Gemini', {
            gem_name: gem,
            text_length: metadata.text_length || 0,
            text: metadata.text
          });
        } else if (stage === 'gemini_generating') {
          await logService.logInfo(finalEntityType, finalEntityID, finalUserID, 'gemini_generating',
            message || 'Đang chờ Gemini tạo kịch bản', {
            gem_name: gem
          });
        } else if (stage === 'gemini_completed') {
          await logService.logSuccess(finalEntityType, finalEntityID, finalUserID, 'gemini_completed',
            message || 'Gemini đã tạo kịch bản xong', {
            gem_name: gem
          });
        } else if (stage === 'file_uploading') {
          await logService.logInfo(finalEntityType, finalEntityID, finalUserID, 'file_uploading',
            message || 'Đang upload file', {
            gem_name: gem,
            file_count: metadata?.file_count || 0
          });
        } else if (stage === 'file_uploaded') {
          await logService.logSuccess(finalEntityType, finalEntityID, finalUserID, 'file_uploaded',
            message || 'Đã upload file thành công', {
            gem_name: gem,
            file_count: metadata?.file_count || 0
          });
        }
      }
    });

    if (sendPromptResult.status === 'success' || sendPromptResult.status === 'prompt_sent') {
      await logService.logSuccess(finalEntityType, finalEntityID, finalUserID, 'outline_uploaded',
        'Đã upload dàn ý lên Gemini thành công', {
        gem_name: gem,
        outline_file: outlineFileName
      });

      // Log text copied if available (gửi toàn bộ text để backend cloud forward lên FE)
      if (sendPromptResult.copiedText) {
        await logService.logInfo(finalEntityType, finalEntityID, finalUserID, 'text_copied_final',
          'Text đã được copy từ Gemini', {
          gem_name: gem,
          text_length: sendPromptResult.copiedText.length,
          text: sendPromptResult.copiedText
        });
      }

      await logService.logSuccess(finalEntityType, finalEntityID, finalUserID, 'generate_outline_completed',
        'Toàn bộ quá trình tạo và upload dàn ý hoàn thành', {
        gem_name: gem,
        outline_file: outlineFileName
      });

      if (profileMonitorService.setAutomationStatus(userDataDir, finalProfileDirName, 'idle')) {
        profileStatusEvent.emitAutomationStatusChange(finalProfileDirName || userDataDir, 'idle', {
          userDataDir,
          profileDirName: finalProfileDirName,
          entityType: finalEntityType,
          entityID: finalEntityID,
          userID: finalUserID
        });
      }
    } else {
      await logService.logWarning(finalEntityType, finalEntityID, finalUserID, 'outline_upload_failed',
        `Upload dàn ý lên Gemini không thành công: ${sendPromptResult.status}`, {
        gem_name: gem,
        outline_file: outlineFileName,
        status: sendPromptResult.status,
        error: sendPromptResult.error || undefined
      });

      if (profileMonitorService.setAutomationStatus(userDataDir, finalProfileDirName, 'idle')) {
        profileStatusEvent.emitAutomationStatusChange(finalProfileDirName || userDataDir, 'idle', {
          userDataDir,
          profileDirName: finalProfileDirName,
          entityType: finalEntityType,
          entityID: finalEntityID,
          userID: finalUserID
        });
      }
    }

    // Xóa file outline sau khi hoàn thành (thành công hoặc thất bại) để tránh tích lũy
    if (fs.existsSync(outlineFilePath)) {
      try {
        fs.unlinkSync(outlineFilePath);
      } catch (unlinkErr) {
        // Ignore error khi xóa file
      }
    }

    return res.json({
      status: 'success',
      notebooklm: notebooklmResult,
      sendPrompt: sendPromptResult,
      outlineFile: outlineFilePath,
      copiedText: sendPromptResult.copiedText || null
    });
  } catch (err) {
    const { name: errorName, userDataDir: errorUserDataDir, profileDirName: errorProfileDirName } = req.body || {};
    let errorContextKey = null;
    let errorContext = null;

    try {
      const errorResolvedUserDataDir = await resolveUserDataDir({
        userDataDir: errorUserDataDir,
        name: errorName,
        profileDirName: errorProfileDirName
      });
      errorContextKey = errorProfileDirName || errorResolvedUserDataDir;
      errorContext = entityContextService.get(errorContextKey);
    } catch (_) {
      // Ignore
    }

    const errorEntityType = errorContext?.entityType || req.headers['x-entity-type'] || req.body.entity_type || 'topic';
    const errorEntityID = errorContext?.entityID || req.headers['x-entity-id'] || req.body.entity_id || 'unknown';
    const errorUserID = errorContext?.userID || req.headers['x-user-id'] || req.body.user_id || 'unknown';

    await logService.logError(errorEntityType, errorEntityID, errorUserID, 'generate_outline_failed',
      `Lỗi khi tạo và upload dàn ý: ${err.message}`, {
      error: err.message,
      gem_name: req.body?.gem || 'unknown'
    });

    try {
      const errorResolvedUserDataDir = await resolveUserDataDir({
        userDataDir: errorUserDataDir,
        name: errorName,
        profileDirName: errorProfileDirName
      });
      const errorFinalProfileDirName = errorProfileDirName || 'Default';
      if (profileMonitorService.setAutomationStatus(errorResolvedUserDataDir, errorFinalProfileDirName, 'idle')) {
        profileStatusEvent.emitAutomationStatusChange(errorFinalProfileDirName || errorResolvedUserDataDir, 'idle', {
          userDataDir: errorResolvedUserDataDir,
          profileDirName: errorFinalProfileDirName,
          entityType: errorEntityType,
          entityID: errorEntityID,
          userID: errorUserID
        });
      }
    } catch (_) {
      // Ignore
    }

    logger.error({ err }, '[Gemini] Error in generate-outline-and-upload');
    return next(err);
  }
});

/**
 * POST /gemini/account/setup
 * Save Google account to google-account.json file
 * This API only saves account credentials to file, does not setup profile
 */
const setupAccountSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/accounts/setup', async (req, res, next) => {
  try {
    const parsed = setupAccountSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'ValidationError', details: parsed.error.issues });
    }

    const { email, password } = parsed.data;

    logger.info({ email }, '[Gemini] Saving Google account via setup API');
    const result = await saveGoogleAccount({ email, password });

    if (result.success) {
      return res.json({
        success: true,
        message: 'Google account saved successfully',
        path: result.path
      });
    } else {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to save Google account'
      });
    }
  } catch (err) {
    logger.error({ err, stack: err?.stack }, '[Gemini] Error in setup account API');
    return next(err);
  }
});

const projectSchema = z.object({
  name: z.string().min(1).optional(),
  userDataDir: z.string().min(1).optional(),
  profileDirName: z.string().min(1).optional().default('Default'),
  debugPort: z.number().optional(),
  project: z.string().min(1),
  gemName: z.string().min(1),
  prompts: z.array(z.object({
    prompt: z.string().min(1),
    output: z.string().optional(), // File name only (e.g., "p1" or "p1.csv"), will be saved as .csv to userDataDir/execution_results/<execution_id>/
    input_files: z.array(z.string()).optional(), // Array of file names (e.g., ["p1", "merged"]), will be resolved from execution_results folders
    exit: z.boolean().optional().default(false),
    merge: z.boolean().optional().default(false),
    prompt_id: z.string().optional()
  })).min(1),
  output_merge: z.string().optional(), // File name for merged result (e.g., "merged_storyboard" or "merged_storyboard.csv"), will be saved as .csv
  entityType: z.string().optional().default('topic'),
  entityID: z.string().optional().default('unknown'),
  userID: z.string().optional().default('unknown'),
  execution_id: z.string().optional()
}).refine((d) => !!d.name || !!d.userDataDir || !!d.debugPort, {
  message: 'Either name, userDataDir, or debugPort must be provided',
  path: ['name'],
});

router.post('/projects', async (req, res, next) => {
  try {
    const parsed = projectSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'ValidationError', details: parsed.error.issues });
    }

    const {
      name,
      userDataDir: inputUserDataDir,
      profileDirName,
      debugPort: inputDebugPort,
      project,
      gemName,
      prompts,
      output_merge,
      entityType = 'topic',
      entityID = 'unknown',
      userID = 'unknown',
      execution_id
    } = parsed.data;

    // Resolve userDataDir: ưu tiên từ request > resolve từ debugPort > resolve từ name
    let userDataDir;
    let resolvedName = name;
    let resolvedProfileDirName = profileDirName;

    if (inputUserDataDir || name) {
      // Có userDataDir hoặc name trong request -> resolve như bình thường
      userDataDir = await resolveUserDataDir({
        userDataDir: inputUserDataDir,
        name,
        profileDirName
      });
    } else if (inputDebugPort) {
      // Không có userDataDir/name nhưng có debugPort -> tìm từ profileMonitorService
      const allMonitored = profileMonitorService.getAllMonitoredProfiles();
      const profileByPort = allMonitored.find(p => p.port === inputDebugPort && p.status === 'running');
      
      if (profileByPort) {
        userDataDir = profileByPort.userDataDir;
        resolvedProfileDirName = profileByPort.profileDirName || 'Default';
        logger.info({ 
          debugPort: inputDebugPort,
          foundUserDataDir: userDataDir,
          foundProfileDirName: resolvedProfileDirName
        }, '[Projects] Resolved userDataDir from debugPort via profileMonitor');
      } else {
        // Không tìm thấy trong profileMonitor -> fallback: thử đọc từ file debugPort
        // Tìm tất cả profiles và check port trong file
        const profilesBaseDir = process.env.CHROME_PROFILES_DIR || path.join(require('os').homedir(), 'AppData', 'Local', 'Automation_Profiles');
        if (await fs.pathExists(profilesBaseDir)) {
          const profileDirs = await fs.readdir(profilesBaseDir);
          for (const profileDir of profileDirs) {
            const profilePath = path.join(profilesBaseDir, profileDir);
            if (await fs.pathExists(profilePath)) {
              try {
                const { readDebugPort } = require('../services/chrome');
                const portFromFile = await readDebugPort(profilePath);
                if (portFromFile === inputDebugPort) {
                  userDataDir = profilePath;
                  resolvedProfileDirName = 'Default';
                  logger.info({ 
                    debugPort: inputDebugPort,
                    foundUserDataDir: userDataDir
                  }, '[Projects] Resolved userDataDir from debugPort via file scan');
                  break;
                }
              } catch (_) {
                // Ignore errors when reading port
              }
            }
          }
        }
        
        if (!userDataDir) {
          return res.status(400).json({ 
            error: 'ValidationError', 
            message: 'Cannot resolve userDataDir from debugPort. Please provide name or userDataDir.',
            debugPort: inputDebugPort
          });
        }
      }
    } else {
      // Không có cả 3 -> validation đã fail ở refine, nhưng để chắc chắn
      return res.status(400).json({ 
        error: 'ValidationError', 
        message: 'Either name, userDataDir, or debugPort must be provided'
      });
    }

    // Lấy entity context từ entityContextService (đã lưu khi launch Chrome)
    // QUAN TRỌNG: Key phải khớp với key đã lưu trong chrome.js
    // chrome.js lưu với key = finalProfileDirName (từ profile.json hoặc getProfileDirNameFromIndex)
    // Cần resolve finalProfileDirName giống như chrome.js
    const profileJsonPath = path.join(userDataDir, 'profile.json');
    let finalProfileDirName = resolvedProfileDirName || 'Default';
    
    if (await fs.pathExists(profileJsonPath)) {
      try {
        const profileMeta = await fs.readJson(profileJsonPath);
        if (profileMeta.profileDirName) {
          finalProfileDirName = profileMeta.profileDirName;
        }
      } catch (_) {}
    } else if (!resolvedProfileDirName && resolvedName) {
      const { getProfileDirNameFromIndex } = require('../utils/resolveUserDataDir');
      const profileDirNameFromIndex = await getProfileDirNameFromIndex(userDataDir, resolvedName);
      finalProfileDirName = profileDirNameFromIndex || 'Default';
    }
    
    // Dùng finalProfileDirName làm key (giống chrome.js)
    const contextKey = finalProfileDirName;
    const savedContext = entityContextService.get(contextKey);

    let finalEntityTypeFromContext = 'topic';
    let finalEntityIDFromContext = 'unknown';
    let finalUserIDFromContext = 'unknown';

    if (savedContext) {
      finalEntityTypeFromContext = savedContext.entityType || 'topic';
      finalEntityIDFromContext = savedContext.entityID || 'unknown';
      finalUserIDFromContext = savedContext.userID || 'unknown';
    } else {
      finalEntityTypeFromContext = req.headers['x-entity-type'] || req.body.entity_type || entityType || 'topic';
      finalEntityIDFromContext = req.headers['x-entity-id'] || req.body.entity_id || entityID || 'unknown';
      finalUserIDFromContext = req.headers['x-user-id'] || req.body.user_id || userID || 'unknown';
    }

    // Resolve debugPort: ưu tiên từ request > profileMonitor > file
    let currentDebugPort;
    
    if (inputDebugPort) {
      // Ưu tiên debugPort từ request (cho phép nhiều Chrome instances song song)
      currentDebugPort = inputDebugPort;
    } else {
      // Fallback: lấy từ profileMonitor hoặc file
      const statusKey = finalProfileDirName;
      const allMonitored = profileMonitorService.getAllMonitoredProfiles();
      const existingProfile = allMonitored.find(p => 
        p.userDataDir === userDataDir && p.profileDirName === finalProfileDirName && p.status === 'running'
      );
      
      if (existingProfile && existingProfile.port) {
        currentDebugPort = existingProfile.port;
      } else {
        const { readDebugPort } = require('../services/chrome');
        currentDebugPort = await readDebugPort(userDataDir);
      }
    }

    await logService.logInfo(finalEntityTypeFromContext, finalEntityIDFromContext, finalUserIDFromContext, 'project_starting',
      `Bắt đầu project: ${project}`, {
        project,
        gem_name: gemName,
        prompts_count: prompts.length,
        execution_id: execution_id || null,
        output_merge: output_merge || null
      });
    
    if (output_merge) {
      logger.info({ output_merge, execution_id }, '[Projects] output_merge specified at project level');
    }

    // Set automationStatus = 'running' để tránh idle timeout khi đang xử lý
    profileMonitorService.setAutomationStatus(userDataDir, finalProfileDirName, 'running');

    // Helper function: Ensure file name has .csv extension
    const ensureCsvExtension = (fileName) => {
      if (!fileName) return null;
      // If already has extension, keep it; otherwise add .csv
      if (path.extname(fileName)) {
        return fileName;
      }
      return `${fileName}.csv`;
    };

    // Helper function: Resolve full path from file name + execution_id
    // Files are stored in: userDataDir/execution_results/<execution_id>/<filename>.csv
    const resolveExecutionFilePath = (fileName, execId) => {
      if (!fileName) return null;
      if (!execId) {
        logger.warn({ fileName }, '[Projects] No execution_id provided, cannot resolve file path');
        return null;
      }
      const fileNameWithExt = ensureCsvExtension(fileName);
      const executionResultsDir = path.join(userDataDir, 'execution_results', execId);
      return path.join(executionResultsDir, fileNameWithExt);
    };

    // Helper function: Find file in execution_results folders (for input_files)
    // Searches in all execution_id folders within userDataDir/execution_results/
    // Automatically adds .csv extension if not present
    const findExecutionFile = async (fileName) => {
      if (!fileName) return null;
      const fileNameWithExt = ensureCsvExtension(fileName);
      const executionResultsBaseDir = path.join(userDataDir, 'execution_results');
      
      if (!await fs.pathExists(executionResultsBaseDir)) {
        logger.warn({ fileName, fileNameWithExt, executionResultsBaseDir }, '[Projects] execution_results directory does not exist');
        return null;
      }

      try {
        const executionDirs = await fs.readdir(executionResultsBaseDir);
        // Search in reverse order (newest first) to prioritize recent files
        for (const execDir of executionDirs.reverse()) {
          const filePath = path.join(executionResultsBaseDir, execDir, fileNameWithExt);
          if (await fs.pathExists(filePath)) {
            logger.info({ fileName, fileNameWithExt, foundIn: execDir, filePath }, '[Projects] Found input file');
            return filePath;
          }
        }
        logger.warn({ fileName, fileNameWithExt, executionResultsBaseDir }, '[Projects] Input file not found in any execution_results folder');
        return null;
      } catch (err) {
        logger.error({ err, fileName, fileNameWithExt, executionResultsBaseDir }, '[Projects] Error searching for input file');
        return null;
      }
    };

    const results = [];
    const globalMergeBuffer = []; // Buffer for merge=true prompts
    let needsGemClick = true;

    // Close existing Gemini tabs before starting new project (Option 1: each project starts with fresh gem)
    try {
      const { connectToBrowserByUserDataDir } = require('../scripts/gmailLogin');
      const { browser } = await connectToBrowserByUserDataDir(userDataDir, currentDebugPort);
      const pages = await browser.pages();
      
      let closedCount = 0;
      for (const page of pages) {
        if (!page.isClosed()) {
          try {
            const pageUrl = page.url();
            if (pageUrl.includes('gemini.google.com')) {
              await page.close();
              closedCount++;
              logger.info({ url: pageUrl }, '[Projects] Closed existing Gemini tab before starting new project');
            }
          } catch (e) {
            // Ignore errors when checking/closing pages
          }
        }
      }
      
      if (closedCount > 0) {
        logger.info({ closedCount }, '[Projects] Closed existing Gemini tabs before starting new project');
        await logService.logInfo(finalEntityTypeFromContext, finalEntityIDFromContext, finalUserIDFromContext, 'project_starting',
          `Đã đóng ${closedCount} tab Gemini cũ trước khi bắt đầu project mới`, {
            project,
            gem_name: gemName,
            closed_tabs: closedCount
          });
      }
    } catch (closeError) {
      logger.warn({ error: closeError?.message }, '[Projects] Failed to close existing Gemini tabs, continuing anyway');
    }

    try {
      for (let i = 0; i < prompts.length; i++) {
        const promptItem = prompts[i];
        const { prompt, output: outputFileName, input_files, exit, merge, prompt_id } = promptItem;

        // Resolve input_files: find files from previous executions
        let resolvedInputFiles = null;
        if (input_files && input_files.length > 0) {
          resolvedInputFiles = [];
          for (const inputFileName of input_files) {
            const foundPath = await findExecutionFile(inputFileName);
            if (foundPath) {
              resolvedInputFiles.push(foundPath);
            } else {
              logger.warn({ inputFileName, prompt_id: prompt_id || `prompt_${i + 1}` }, '[Projects] Input file not found, skipping');
            }
          }
          if (resolvedInputFiles.length === 0) {
            resolvedInputFiles = null; // No valid files found
          }
          logger.info({ 
            prompt_id: prompt_id || `prompt_${i + 1}`,
            input_files,
            resolvedInputFiles,
            needsGemClick
          }, '[Projects] Resolved input_files');
        }

        // Resolve output path: userDataDir/execution_results/<execution_id>/<outputFileName>
        const outputPath = outputFileName ? resolveExecutionFilePath(outputFileName, execution_id) : null;
        if (outputPath) {
          logger.info({ 
            prompt_id: prompt_id || `prompt_${i + 1}`,
            outputFileName,
            outputPath,
            execution_id
          }, '[Projects] Resolved output path');
        }

        logger.info({ 
          project, 
          gem_name: gemName, 
          prompt_index: i, 
          total_prompts: prompts.length,
          prompt_id: prompt_id || `prompt_${i + 1}`,
          needsGemClick 
        }, `[DEBUG] Bắt đầu vòng lặp prompt ${i + 1}/${prompts.length}`);

        await logService.logInfo(finalEntityTypeFromContext, finalEntityIDFromContext, finalUserIDFromContext, 'prompt_processing',
          `Đang xử lý prompt ${i + 1}/${prompts.length}`, {
            project,
            gem_name: gemName,
            prompt_id: prompt_id || `prompt_${i + 1}`,
            prompt_preview: prompt.substring(0, 100),
            isMerge: !!merge
          });

        try {
          let promptResult;
          
          if (needsGemClick) {
            logger.info({ 
              project, 
              gem_name: gemName, 
              prompt_id: prompt_id || `prompt_${i + 1}` 
            }, `[DEBUG] Gọi sendPrompt cho prompt ${i + 1}`);
            promptResult = await sendPrompt({
              userDataDir,
              debugPort: currentDebugPort,
              gem: gemName,
              listFile: resolvedInputFiles || undefined,
              prompt,
              entityType: finalEntityTypeFromContext,
              entityID: finalEntityIDFromContext,
              userID: finalUserIDFromContext,
              onProgress: async (stage, message, metadata) => {
                if (stage === 'text_copied' && metadata && metadata.text) {
                  // [DEBUG] Log raw event
                  logger.info({ prompt_id: prompt_id || `prompt_${i + 1}`, merge, text_len: metadata.text_length }, '[DEBUG] onProgress text_copied received');
                  
                  if (!merge) {
                    await logService.logInfo(finalEntityTypeFromContext, finalEntityIDFromContext, finalUserIDFromContext, 'prompt_response_received',
                      `Đã nhận response từ Gemini cho prompt ${prompt_id || `prompt_${i + 1}`}`, {
                        project,
                        gem_name: gemName,
                        prompt_id: prompt_id || `prompt_${i + 1}`,
                        text_length: metadata.text_length || 0,
                        text: metadata.text,
                        execution_id: execution_id || null
                      });
                  } else {
                     logger.info({ prompt_id: prompt_id || `prompt_${i + 1}` }, '[DEBUG] Suppressing prompt_response_received event due to merge=true');
                  }
                }
              }
            });
            needsGemClick = false;
            logger.info({ 
              project, 
              gem_name: gemName, 
              prompt_id: prompt_id || `prompt_${i + 1}`,
              status: promptResult?.status,
              hasText: !!promptResult?.copiedText
            }, `[DEBUG] Đã hoàn thành sendPrompt cho prompt ${i + 1}`);
          } else {
            logger.info({ 
              project, 
              gem_name: gemName, 
              prompt_id: prompt_id || `prompt_${i + 1}` 
            }, `[DEBUG] Gọi sendNextPrompt cho prompt ${i + 1}`);
            // Note: sendNextPrompt doesn't support listFile (files are already in conversation)
            // Only sendPrompt (first prompt) needs listFile
            promptResult = await sendNextPrompt({
              userDataDir,
              debugPort: currentDebugPort,
              prompt,
              entityType: finalEntityTypeFromContext,
              entityID: finalEntityIDFromContext,
              userID: finalUserIDFromContext,
              onProgress: async (stage, message, metadata) => {
                if (stage === 'text_copied' && metadata && metadata.text) {
                   // [DEBUG] Log raw event
                  logger.info({ prompt_id: prompt_id || `prompt_${i + 1}`, merge, text_len: metadata.text_length }, '[DEBUG] onProgress (next) text_copied received');

                  if (!merge) {
                    await logService.logInfo(finalEntityTypeFromContext, finalEntityIDFromContext, finalUserIDFromContext, 'prompt_response_received',
                      `Đã nhận response từ Gemini cho prompt ${prompt_id || `prompt_${i + 1}`}`, {
                        project,
                        gem_name: gemName,
                        prompt_id: prompt_id || `prompt_${i + 1}`,
                        text_length: metadata.text_length || 0,
                        text: metadata.text,
                        execution_id: execution_id || null
                      });
                  } else {
                     logger.info({ prompt_id: prompt_id || `prompt_${i + 1}` }, '[DEBUG] Suppressing prompt_response_received event due to merge=true');
                  }
                }
              }
            });
            logger.info({ 
              project, 
              gem_name: gemName, 
              prompt_id: prompt_id || `prompt_${i + 1}`,
              status: promptResult?.status,
              hasText: !!promptResult?.copiedText
            }, `[DEBUG] Đã hoàn thành sendNextPrompt cho prompt ${i + 1}`);
          }

          logger.info({ 
            project, 
            gem_name: gemName, 
            prompt_id: prompt_id || `prompt_${i + 1}`,
            status: promptResult?.status,
            hasText: !!promptResult?.copiedText,
            error: promptResult?.error
          }, `[DEBUG] Kiểm tra kết quả prompt ${i + 1}`);

          if (promptResult.status === 'success' && promptResult.copiedText) {
            const text = promptResult.copiedText;
            let savedPath = null;

            if (outputPath) {
              try {
                const outputDir = path.dirname(outputPath);
                if (!await fs.pathExists(outputDir)) {
                  await fs.mkdirs(outputDir);
                }
                await fs.writeFile(outputPath, text, 'utf8');
                savedPath = outputPath;
                await logService.logSuccess(finalEntityTypeFromContext, finalEntityIDFromContext, finalUserIDFromContext, 'output_saved',
                  `Đã lưu output vào file: ${outputPath}`, {
                    project,
                    gem_name: gemName,
                    prompt_id: prompt_id || `prompt_${i + 1}`,
                    output_file: outputPath
                  });
              } catch (saveError) {
                await logService.logError(finalEntityTypeFromContext, finalEntityIDFromContext, finalUserIDFromContext, 'output_save_failed',
                  `Không thể lưu output vào file: ${outputPath}`, {
                    project,
                    gem_name: gemName,
                    prompt_id: prompt_id || `prompt_${i + 1}`,
                    output_file: outputPath,
                    error: saveError.message
                  });
              }
            }

            await logService.logSuccess(finalEntityTypeFromContext, finalEntityIDFromContext, finalUserIDFromContext, 'prompt_completed',
              `Đã hoàn thành prompt ${prompt_id || `prompt_${i + 1}`}`, {
                project,
                gem_name: gemName,
                prompt_id: prompt_id || `prompt_${i + 1}`,
                text_length: text.length,
                output_file: savedPath
              });

            results.push({
              prompt_id: prompt_id || `prompt_${i + 1}`,
              prompt,
              status: 'success',
              output: savedPath,
              text,
              exitPerformed: false,
              execution_id: execution_id || null
            });

            if (merge) {
              const lastRes = results[results.length - 1];
              if (lastRes && lastRes.prompt_id === (prompt_id || `prompt_${i + 1}`)) {
                  globalMergeBuffer.push(lastRes);
                  results.pop();
              }
            }

            if (exit) {
              await logService.logInfo(finalEntityTypeFromContext, finalEntityIDFromContext, finalUserIDFromContext, 'profile_restart_starting',
                `Bắt đầu restart profile sau prompt ${prompt_id || `prompt_${i + 1}`}`, {
                  project,
                  gem_name: gemName,
                  prompt_id: prompt_id || `prompt_${i + 1}`
                });

              try {
                await stopChromeProfile({
                  userDataDir,
                  profileDirName: finalProfileDirName
                });

                const { exec } = require('child_process');
                const util = require('util');
                const execPromise = util.promisify(exec);

                let attempts = 0;
                const maxAttempts = 10;
                const checkInterval = 500;

                while (attempts < maxAttempts) {
                  try {
                    const { stdout } = await execPromise(`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'chrome.exe' -and $_.CommandLine -match '--user-data-dir=${userDataDir.replace(/\\/g, '\\\\')}' } | Select-Object -ExpandProperty ProcessId"`);
                    const pids = stdout.trim().split('\n').filter(pid => pid.trim() && !isNaN(parseInt(pid.trim())));
                    if (pids.length === 0) {
                      break;
                    }
                  } catch (_) {
                    break;
                  }
                  attempts++;
                  await new Promise(resolve => setTimeout(resolve, checkInterval));
                }

                await new Promise(resolve => setTimeout(resolve, 1000));

                const launchParams = {
                  userDataDir,
                  profileDirName: finalProfileDirName,
                  ensureGmail: false,
                  headless: false,
                  debugPort: currentDebugPort // Giữ nguyên debugPort khi restart
                };

                logger.info({ 
                  project, 
                  gem_name: gemName, 
                  debugPort: currentDebugPort,
                  prompt_id: prompt_id || `prompt_${i + 1}`
                }, '[DEBUG] Restart profile với debugPort');

                await launchChromeProfile(launchParams);
                
                // Sau khi launch, đọc lại port để đảm bảo đúng
                const { readDebugPort } = require('../services/chrome');
                const newDebugPort = await readDebugPort(userDataDir);
                
                // Nếu port mới khác port yêu cầu, log warning
                if (newDebugPort !== currentDebugPort) {
                  logger.warn({
                    project,
                    gem_name: gemName,
                    requestedPort: currentDebugPort,
                    actualPort: newDebugPort
                  }, '[DEBUG] Port sau restart khác với port yêu cầu');
                }
                
                currentDebugPort = newDebugPort;

                needsGemClick = true;

                await logService.logSuccess(finalEntityTypeFromContext, finalEntityIDFromContext, finalUserIDFromContext, 'profile_restart_completed',
                  `Đã restart profile thành công sau prompt ${prompt_id || `prompt_${i + 1}`}`, {
                    project,
                    gem_name: gemName,
                    prompt_id: prompt_id || `prompt_${i + 1}`,
                    debug_port: currentDebugPort
                  });

                results[results.length - 1].exitPerformed = true;
              } catch (restartError) {
                await logService.logError(finalEntityTypeFromContext, finalEntityIDFromContext, finalUserIDFromContext, 'profile_restart_failed',
                  `Không thể restart profile sau prompt ${prompt_id || `prompt_${i + 1}`}`, {
                    project,
                    gem_name: gemName,
                    prompt_id: prompt_id || `prompt_${i + 1}`,
                    error: restartError.message
                  });
                results[results.length - 1].exitPerformed = false;
              }
            }
          } else {
            await logService.logError(finalEntityTypeFromContext, finalEntityIDFromContext, finalUserIDFromContext, 'prompt_failed',
              `Không thể xử lý prompt ${prompt_id || `prompt_${i + 1}`}`, {
                project,
                gem_name: gemName,
                prompt_id: prompt_id || `prompt_${i + 1}`,
                error: promptResult.error || 'Unknown error'
              });

            results.push({
              prompt_id: prompt_id || `prompt_${i + 1}`,
              prompt,
              status: 'failed',
              error: promptResult.error || 'Unknown error',
              exitPerformed: false,
              execution_id: execution_id || null
            });
          }

          if (merge && promptResult?.status !== 'success') {
             // Even if failed, if it was marked as merge, we adding it to buffer or handling fail?
             // Simple logic: If failed, we still add to results (it was pushed above in catch block or else block)
             // Check if the last result pushed matches this prompt
             const lastRes = results[results.length -1];
             if (lastRes && lastRes.prompt_id === (prompt_id || `prompt_${i + 1}`)) {
                 globalMergeBuffer.push(lastRes);
                 results.pop();
             }
          }

          logger.info({ 
            project, 
            gem_name: gemName, 
            prompt_id: prompt_id || `prompt_${i + 1}`,
            next_index: i + 1,
            total_prompts: prompts.length,
            will_continue: i + 1 < prompts.length
          }, `[DEBUG] Đã xử lý xong prompt ${i + 1}, ${i + 1 < prompts.length ? 'sẽ tiếp tục' : 'đã hết prompts'}`);
        } catch (promptError) {
          logger.error({ 
            project, 
            gem_name: gemName, 
            prompt_id: prompt_id || `prompt_${i + 1}`,
            error: promptError.message,
            stack: promptError.stack
          }, `[DEBUG] Lỗi trong catch block của prompt ${i + 1}`);

          await logService.logError(finalEntityTypeFromContext, finalEntityIDFromContext, finalUserIDFromContext, 'prompt_error',
            `Lỗi khi xử lý prompt ${prompt_id || `prompt_${i + 1}`}`, {
              project,
              gem_name: gemName,
              prompt_id: prompt_id || `prompt_${i + 1}`,
              error: promptError.message
            });

          results.push({
            prompt_id: prompt_id || `prompt_${i + 1}`,
            prompt,
            status: 'failed',
            error: promptError.message,
            exitPerformed: false,
            execution_id: execution_id || null
          });
          
          if (merge) {
             const lastRes = results[results.length -1];
             if (lastRes && lastRes.prompt_id === (prompt_id || `prompt_${i + 1}`)) {
                 globalMergeBuffer.push(lastRes);
                 results.pop();
             }
          }
        }
      }

      // Proccess Global Merge Buffer at the end
      if (globalMergeBuffer.length > 0) {
          const mergedText = globalMergeBuffer.map(r => r.text || '').join('\n');
          // Use info from the LAST prompt in the buffer for the merged entry
          const lastItem = globalMergeBuffer[globalMergeBuffer.length - 1];
          
          // Resolve output_merge path from project level (not from prompts)
          const mergeOutputPath = output_merge ? resolveExecutionFilePath(output_merge, execution_id) : null;

          // Save merged text to file if output_merge is specified
          let mergeSavedPath = null;
          if (mergeOutputPath) {
            try {
              const mergeOutputDir = path.dirname(mergeOutputPath);
              if (!await fs.pathExists(mergeOutputDir)) {
                await fs.mkdirs(mergeOutputDir);
              }
              await fs.writeFile(mergeOutputPath, mergedText, 'utf8');
              mergeSavedPath = mergeOutputPath;
              await logService.logSuccess(finalEntityTypeFromContext, finalEntityIDFromContext, finalUserIDFromContext, 'merged_output_saved',
                `Đã lưu merged output vào file: ${mergeOutputPath}`, {
                  project,
                  gem_name: gemName,
                  prompt_id: 'merged_result',
                  output_file: mergeOutputPath,
                  merged_count: globalMergeBuffer.length
                });
            } catch (saveError) {
              await logService.logError(finalEntityTypeFromContext, finalEntityIDFromContext, finalUserIDFromContext, 'merged_output_save_failed',
                `Không thể lưu merged output vào file: ${mergeOutputPath}`, {
                  project,
                  gem_name: gemName,
                  prompt_id: 'merged_result',
                  output_file: mergeOutputPath,
                  error: saveError.message
                });
            }
          }
          
          const mergedResult = {
              ...lastItem,
              prompt: 'MERGED_PROMPTS',
              prompt_id: 'merged_result',
              text: mergedText,
              status: globalMergeBuffer.every(r => r.status === 'success') ? 'success' : 'partial_failed',
              is_merged: true,
              merged_count: globalMergeBuffer.length,
              output: mergeSavedPath
          };
          
          await logService.logSuccess(finalEntityTypeFromContext, finalEntityIDFromContext, finalUserIDFromContext, 'merged_response_received',
            `Đã hoàn thành merge ${globalMergeBuffer.length} prompts và trả kết quả`, {
              project,
              gem_name: gemName,
              prompt_id: 'merged_result',
              text_length: mergedText.length,
              text: mergedText, // Trả full merged text
              merged_count: globalMergeBuffer.length,
              output_file: mergeSavedPath
            });

          results.push(mergedResult);
      }


      const successCount = results.filter(r => r.status === 'success').length;
      const failedCount = results.filter(r => r.status === 'failed').length;

      await logService.logInfo(finalEntityTypeFromContext, finalEntityIDFromContext, finalUserIDFromContext, 'project_completed',
        `Hoàn thành project: ${project}`, {
          project,
          gem_name: gemName,
          total_prompts: prompts.length,
          success_count: successCount,
          failed_count: failedCount,
          execution_id: execution_id || null
        });

      // Set automationStatus = 'idle' khi project hoàn thành
      profileMonitorService.setAutomationStatus(userDataDir, finalProfileDirName, 'idle');

      return res.json({
        status: failedCount === 0 ? 'success' : (successCount > 0 ? 'partial' : 'failed'),
        project,
        gemName,
        execution_id: execution_id || null,
        results,
        summary: {
          total: prompts.length,
          success: successCount,
          failed: failedCount
        }
      });
    } catch (error) {
      await logService.logError(finalEntityTypeFromContext, finalEntityIDFromContext, finalUserIDFromContext, 'project_error',
        `Lỗi khi xử lý project: ${gemName}`, {
          project: gemName,
          gem_name: gemName,
          error: error.message,
          execution_id: execution_id || null
        });

      // Set automationStatus = 'idle' khi có lỗi
      profileMonitorService.setAutomationStatus(userDataDir, finalProfileDirName, 'idle');

      return res.status(500).json({
        status: 'failed',
        project,
        gemName,
        execution_id: execution_id || null,
        error: error.message,
        results
      });
    }
  } catch (err) {
    return next(err);
  }
});

module.exports = router;


