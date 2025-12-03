const express = require('express');
const { z } = require('zod');
const path = require('path');
const fs = require('fs-extra');
const { logger } = require('../logger');
const { resolveUserDataDir } = require('../utils/resolveUserDataDir');
const { downloadFiles } = require('../utils/downloadFile');
const { createGem } = require('../scripts/gemini');
const { listGems } = require('../scripts/listGems');
const { sendPrompt } = require('../scripts/sendPrompt');
const { launchNotebookLM } = require('../scripts/notebooklm');
const logService = require('../services/logService');
const entityContextService = require('../services/entityContext');
const profileMonitorService = require('../services/profileMonitor');
const profileStatusEvent = require('../services/profileStatusEvent');

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
    // Ưu tiên: profileDirName -> userDataDir
    const contextKey = profileDirName || userDataDir;
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
      debugPort 
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

    const contextKey = profileDirName || userDataDir;
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
    
    const finalProfileDirName = profileDirName || 'Default';

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
      outputFile: outlineFilePath
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

module.exports = router;


